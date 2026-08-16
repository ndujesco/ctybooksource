import type { Document } from "mongodb";
import { invoices, books as booksCol, customers as customersCol } from "@/lib/mongodb";
import {
  type Bucket,
  type Range,
  bucketFor,
  bucketKey,
  bucketKeys,
  daysAgo,
  formatBucket,
  today,
} from "@/lib/datetime";
import { round2 } from "@/lib/types";

/* ---------------------------------------------------------------------------
   Only "open" invoices count as sales. Drafts are half-typed and cancelled
   invoices never happened, so both stay out of every number on every screen.
   ------------------------------------------------------------------------ */
const SALES: Document = { deleted: { $ne: true }, status: "open" };

function inRange(r: Range): Document {
  return { ...SALES, date: { $gte: r.from, $lte: r.to } };
}

/**
 * A line's share of the invoice after the whole-invoice discount is spread
 * across it proportionally. Without this, product revenue would add up to more
 * than the invoices it came from.
 */
const LINE_REVENUE: Document = {
  $multiply: [
    { $ifNull: ["$lines.qty", 0] },
    { $ifNull: ["$lines.unitPrice", 0] },
    { $subtract: [1, { $divide: [{ $ifNull: ["$discountPercent", 0] }, 100] }] },
  ],
};

const LINE_COST: Document = {
  $multiply: [{ $ifNull: ["$lines.qty", 0] }, { $ifNull: ["$lines.costPrice", 0] }],
};

/* ---- Headline numbers -------------------------------------------------- */

export type Kpi = {
  sales: number; // invoiced in the period
  collected: number; // cash actually received in the period
  outstanding: number; // still owed on invoices raised in the period
  invoiceCount: number;
  customerCount: number;
  qty: number; // books sold
  cost: number;
  profit: number;
  margin: number; // %
  avgInvoice: number;
};

const EMPTY_KPI: Kpi = {
  sales: 0, collected: 0, outstanding: 0, invoiceCount: 0, customerCount: 0,
  qty: 0, cost: 0, profit: 0, margin: 0, avgInvoice: 0,
};

export async function kpi(range: Range): Promise<Kpi> {
  const col = await invoices();

  const [totals] = await col
    .aggregate<Document>([
      { $match: inRange(range) },
      {
        $group: {
          _id: null,
          sales: { $sum: "$totals.total" },
          outstanding: { $sum: "$balance" },
          cost: { $sum: "$totals.cost" },
          qty: { $sum: "$totals.qty" },
          invoiceCount: { $sum: 1 },
          customers: { $addToSet: { $ifNull: ["$customerId", "$customerName"] } },
        },
      },
    ])
    .toArray();

  // Cash received is dated by the payment, not the invoice — a July invoice
  // paid in August is August's money.
  const [cash] = await col
    .aggregate<Document>([
      { $match: SALES },
      { $unwind: "$payments" },
      { $match: { "payments.date": { $gte: range.from, $lte: range.to } } },
      { $group: { _id: null, collected: { $sum: "$payments.amount" } } },
    ])
    .toArray();

  if (!totals) return { ...EMPTY_KPI, collected: round2(cash?.collected || 0) };

  const sales = round2(totals.sales || 0);
  const cost = round2(totals.cost || 0);
  const profit = round2(sales - cost);
  const invoiceCount = totals.invoiceCount || 0;

  return {
    sales,
    collected: round2(cash?.collected || 0),
    outstanding: round2(totals.outstanding || 0),
    invoiceCount,
    customerCount: (totals.customers || []).filter(Boolean).length,
    qty: totals.qty || 0,
    cost,
    profit,
    margin: sales > 0 ? round2((profit / sales) * 100) : 0,
    avgInvoice: invoiceCount > 0 ? round2(sales / invoiceCount) : 0,
  };
}

/** Percentage change, guarding the divide-by-zero that a first month hits. */
export function growth(now: number, before: number): number | null {
  if (!before) return now > 0 ? null : 0; // null renders as "new", not "+∞%"
  return round2(((now - before) / Math.abs(before)) * 100);
}

/* ---- Sales over time --------------------------------------------------- */

export type SeriesPoint = {
  key: string;
  label: string;
  sales: number;
  collected: number;
  profit: number;
};

export async function series(range: Range): Promise<{ bucket: Bucket; points: SeriesPoint[] }> {
  const bucket = bucketFor(range);
  const col = await invoices();

  const sold = await col
    .aggregate<Document>([
      { $match: inRange(range) },
      {
        $group: {
          _id: "$date",
          sales: { $sum: "$totals.total" },
          cost: { $sum: "$totals.cost" },
        },
      },
    ])
    .toArray();

  const paid = await col
    .aggregate<Document>([
      { $match: SALES },
      { $unwind: "$payments" },
      { $match: { "payments.date": { $gte: range.from, $lte: range.to } } },
      { $group: { _id: "$payments.date", collected: { $sum: "$payments.amount" } } },
    ])
    .toArray();

  const acc = new Map<string, SeriesPoint>();
  for (const key of bucketKeys(range, bucket)) {
    acc.set(key, { key, label: formatBucket(key, bucket), sales: 0, collected: 0, profit: 0 });
  }
  const bump = (date: string, fn: (p: SeriesPoint) => void) => {
    const key = bucketKey(date, bucket);
    const point = acc.get(key);
    if (point) fn(point);
  };
  for (const row of sold) {
    bump(String(row._id), (p) => {
      p.sales = round2(p.sales + (row.sales || 0));
      p.profit = round2(p.profit + ((row.sales || 0) - (row.cost || 0)));
    });
  }
  for (const row of paid) {
    bump(String(row._id), (p) => {
      p.collected = round2(p.collected + (row.collected || 0));
    });
  }

  return { bucket, points: [...acc.values()] };
}

/* ---- Products ---------------------------------------------------------- */

export type ProductRow = {
  bookId: string | null;
  name: string;
  fullName: string;
  publisher: string;
  category: string;
  qty: number;
  revenue: number;
  cost: number;
  profit: number;
  orders: number;
  lastSold: string | null;
  daysSinceSold: number | null;
};

export async function products(range: Range, limit = 100): Promise<ProductRow[]> {
  const col = await invoices();
  const rows = await col
    .aggregate<Document>([
      { $match: inRange(range) },
      { $unwind: "$lines" },
      { $match: { "lines.qty": { $gt: 0 } } },
      {
        $group: {
          // Books added to the catalogue group by id; anything typed free-hand
          // onto an invoice groups by the name that was typed.
          _id: { $ifNull: ["$lines.bookId", { $concat: ["~", "$lines.shortName"] }] },
          name: { $last: "$lines.shortName" },
          fullName: { $last: "$lines.fullName" },
          publisher: { $last: "$lines.publisher" },
          category: { $last: "$lines.category" },
          qty: { $sum: "$lines.qty" },
          revenue: { $sum: LINE_REVENUE },
          cost: { $sum: LINE_COST },
          orders: { $sum: 1 },
          lastSold: { $max: "$date" },
        },
      },
      { $sort: { revenue: -1 } },
      { $limit: limit },
    ])
    .toArray();

  return rows.map(toProductRow);
}

function toProductRow(r: Document): ProductRow {
  const id = String(r._id ?? "");
  const revenue = round2(r.revenue || 0);
  const cost = round2(r.cost || 0);
  const lastSold = (r.lastSold as string) || null;
  return {
    bookId: id.startsWith("~") || !id ? null : id,
    name: r.name || r.fullName || "Unnamed book",
    fullName: r.fullName || "",
    publisher: r.publisher || "",
    category: r.category || "",
    qty: r.qty || 0,
    revenue,
    cost,
    profit: round2(revenue - cost),
    orders: r.orders || 0,
    lastSold,
    daysSinceSold: lastSold ? daysAgo(lastSold) : null,
  };
}

/**
 * Catalogue books that aren't moving: never sold, or nothing sold in the last
 * `staleDays`. Driven off the books collection so a book that has never
 * appeared on an invoice still shows up — that's exactly the money tied up.
 */
export async function slowMovers(staleDays = 60, limit = 40): Promise<ProductRow[]> {
  const [inv, bcol] = await Promise.all([invoices(), booksCol()]);

  const sold = await inv
    .aggregate<Document>([
      { $match: SALES },
      { $unwind: "$lines" },
      { $match: { "lines.qty": { $gt: 0 }, "lines.bookId": { $ne: null } } },
      {
        $group: {
          _id: "$lines.bookId",
          qty: { $sum: "$lines.qty" },
          revenue: { $sum: LINE_REVENUE },
          cost: { $sum: LINE_COST },
          orders: { $sum: 1 },
          lastSold: { $max: "$date" },
        },
      },
    ])
    .toArray();

  const byId = new Map(sold.map((r) => [String(r._id), r]));
  const catalogue = await bcol.find({ archived: { $ne: true } }).limit(2000).toArray();

  const rows: ProductRow[] = catalogue.map((b) => {
    const s = byId.get(String(b._id));
    const revenue = round2(s?.revenue || 0);
    const cost = round2(s?.cost || 0);
    const lastSold = (s?.lastSold as string) || null;
    return {
      bookId: String(b._id),
      name: b.shortName || b.fullName || "Unnamed book",
      fullName: b.fullName || "",
      publisher: b.publisher || "",
      category: b.category || "",
      qty: s?.qty || 0,
      revenue,
      cost,
      profit: round2(revenue - cost),
      orders: s?.orders || 0,
      lastSold,
      daysSinceSold: lastSold ? daysAgo(lastSold) : null,
    };
  });

  return rows
    .filter((r) => r.daysSinceSold === null || r.daysSinceSold >= staleDays)
    // Never-sold first, then the longest-dormant.
    .sort((a, b) => (b.daysSinceSold ?? 1e9) - (a.daysSinceSold ?? 1e9))
    .slice(0, limit);
}

/* ---- Customers --------------------------------------------------------- */

export type CustomerRow = {
  customerId: string | null;
  name: string;
  phone: string;
  revenue: number;
  orders: number;
  qty: number;
  paid: number;
  owed: number;
  profit: number;
  avgOrder: number;
  firstPurchase: string | null;
  lastPurchase: string | null;
  daysSincePurchase: number | null;
};

/** Per-customer rollup. Omit the range for lifetime figures. */
export async function customerStats(range?: Range, limit = 200): Promise<CustomerRow[]> {
  const col = await invoices();
  const rows = await col
    .aggregate<Document>([
      { $match: range ? inRange(range) : SALES },
      {
        $group: {
          _id: { $ifNull: ["$customerId", { $concat: ["~", "$customerName"] }] },
          name: { $last: "$customerName" },
          phone: { $last: "$customerPhone" },
          revenue: { $sum: "$totals.total" },
          cost: { $sum: "$totals.cost" },
          qty: { $sum: "$totals.qty" },
          paid: { $sum: "$amountPaid" },
          owed: { $sum: "$balance" },
          orders: { $sum: 1 },
          firstPurchase: { $min: "$date" },
          lastPurchase: { $max: "$date" },
        },
      },
      { $sort: { revenue: -1 } },
      { $limit: limit },
    ])
    .toArray();

  return rows.map((r) => {
    const id = String(r._id ?? "");
    const revenue = round2(r.revenue || 0);
    const orders = r.orders || 0;
    const last = (r.lastPurchase as string) || null;
    return {
      customerId: id.startsWith("~") || !id ? null : id,
      name: r.name || "Unnamed customer",
      phone: r.phone || "",
      revenue,
      orders,
      qty: r.qty || 0,
      paid: round2(r.paid || 0),
      owed: round2(r.owed || 0),
      profit: round2(revenue - (r.cost || 0)),
      avgOrder: orders > 0 ? round2(revenue / orders) : 0,
      firstPurchase: (r.firstPurchase as string) || null,
      lastPurchase: last,
      daysSincePurchase: last ? daysAgo(last) : null,
    };
  });
}

/** Customers who've gone quiet — the follow-up list. */
export async function dormantCustomers(quietDays = 45, limit = 30): Promise<CustomerRow[]> {
  const [stats, ccol] = await Promise.all([customerStats(undefined, 1000), customersCol()]);
  const seen = new Set(stats.map((s) => s.customerId).filter(Boolean));

  // A customer on file who has never bought anything is dormant too.
  const never = (await ccol.find({ archived: { $ne: true } }).limit(2000).toArray())
    .filter((c) => !seen.has(String(c._id)))
    .map<CustomerRow>((c) => ({
      customerId: String(c._id),
      name: c.name,
      phone: c.phone || "",
      revenue: 0, orders: 0, qty: 0, paid: 0, owed: 0, profit: 0, avgOrder: 0,
      firstPurchase: null, lastPurchase: null, daysSincePurchase: null,
    }));

  return [...stats.filter((s) => (s.daysSincePurchase ?? 1e9) >= quietDays), ...never]
    .sort((a, b) => (b.daysSincePurchase ?? 1e9) - (a.daysSincePurchase ?? 1e9))
    .slice(0, limit);
}

/* ---- Receivables ------------------------------------------------------- */

export type DebtRow = {
  invoiceId: string;
  number: number;
  date: string;
  customerId: string | null;
  customerName: string;
  total: number;
  paid: number;
  balance: number;
  ageDays: number;
};

export type AgingBucket = { label: string; amount: number; count: number };

export type Receivables = {
  totalOutstanding: number;
  invoiceCount: number;
  customerCount: number;
  aging: AgingBucket[];
  oldest: DebtRow[];
  largest: DebtRow[];
  topDebtors: CustomerRow[];
};

// Ages are days since the invoice date. Small enough set to bucket in JS.
const AGING = [
  { label: "0–30 days", max: 30 },
  { label: "31–60 days", max: 60 },
  { label: "61–90 days", max: 90 },
  { label: "Over 90 days", max: Infinity },
];

export async function receivables(): Promise<Receivables> {
  const col = await invoices();
  const docs = await col
    .find({ ...SALES, balance: { $gt: 0.01 } })
    .sort({ date: 1 })
    .limit(2000)
    .toArray();

  const rows: DebtRow[] = docs.map((d) => ({
    invoiceId: String(d._id),
    number: d.number,
    date: d.date,
    customerId: d.customerId,
    customerName: d.customerName || "Unnamed customer",
    total: round2(d.totals?.total || 0),
    paid: round2(d.amountPaid || 0),
    balance: round2(d.balance || 0),
    ageDays: daysAgo(d.date),
  }));

  const aging: AgingBucket[] = AGING.map((b) => ({ label: b.label, amount: 0, count: 0 }));
  for (const r of rows) {
    const i = AGING.findIndex((b) => r.ageDays <= b.max);
    const bucket = aging[i === -1 ? aging.length - 1 : i];
    bucket.amount = round2(bucket.amount + r.balance);
    bucket.count += 1;
  }

  const owedBy = new Map<string, CustomerRow>();
  for (const r of rows) {
    const key = r.customerId || `~${r.customerName}`;
    const existing = owedBy.get(key);
    if (existing) {
      existing.owed = round2(existing.owed + r.balance);
      existing.orders += 1;
      if (!existing.lastPurchase || r.date > existing.lastPurchase) existing.lastPurchase = r.date;
    } else {
      owedBy.set(key, {
        customerId: r.customerId,
        name: r.customerName,
        phone: "",
        revenue: 0, qty: 0, paid: 0, profit: 0, avgOrder: 0,
        owed: r.balance,
        orders: 1,
        firstPurchase: r.date,
        lastPurchase: r.date,
        daysSincePurchase: r.ageDays,
      });
    }
  }

  return {
    totalOutstanding: round2(rows.reduce((s, r) => s + r.balance, 0)),
    invoiceCount: rows.length,
    customerCount: owedBy.size,
    aging,
    oldest: [...rows].sort((a, b) => b.ageDays - a.ageDays).slice(0, 15),
    largest: [...rows].sort((a, b) => b.balance - a.balance).slice(0, 15),
    topDebtors: [...owedBy.values()].sort((a, b) => b.owed - a.owed).slice(0, 15),
  };
}

/* ---- Grouped breakdowns (publisher / category) ------------------------- */

export type GroupRow = {
  key: string;
  qty: number;
  revenue: number;
  cost: number;
  profit: number;
  margin: number;
  share: number; // % of revenue in the period
};

export async function groupBy(
  field: "publisher" | "category",
  range: Range,
  limit = 30
): Promise<GroupRow[]> {
  const col = await invoices();
  const rows = await col
    .aggregate<Document>([
      { $match: inRange(range) },
      { $unwind: "$lines" },
      { $match: { "lines.qty": { $gt: 0 } } },
      {
        $group: {
          _id: {
            $let: {
              vars: { v: { $trim: { input: { $ifNull: [`$lines.${field}`, ""] } } } },
              in: { $cond: [{ $eq: ["$$v", ""] }, "Unspecified", "$$v"] },
            },
          },
          qty: { $sum: "$lines.qty" },
          revenue: { $sum: LINE_REVENUE },
          cost: { $sum: LINE_COST },
        },
      },
      { $sort: { revenue: -1 } },
      { $limit: limit },
    ])
    .toArray();

  const total = rows.reduce((s, r) => s + (r.revenue || 0), 0);
  return rows.map((r) => {
    const revenue = round2(r.revenue || 0);
    const cost = round2(r.cost || 0);
    const profit = round2(revenue - cost);
    return {
      key: String(r._id),
      qty: r.qty || 0,
      revenue,
      cost,
      profit,
      margin: revenue > 0 ? round2((profit / revenue) * 100) : 0,
      share: total > 0 ? round2((revenue / total) * 100) : 0,
    };
  });
}

/* ---- Home dashboard ---------------------------------------------------- */

export type RecentInvoice = {
  id: string;
  number: number;
  date: string;
  customerName: string;
  total: number;
  balance: number;
  payStatus: string;
  status: string;
};

export async function recentInvoices(limit = 8): Promise<RecentInvoice[]> {
  const col = await invoices();
  const docs = await col
    .find({ deleted: { $ne: true } })
    .sort({ date: -1, number: -1 })
    .limit(limit)
    .toArray();
  return docs.map((d) => ({
    id: String(d._id),
    number: d.number,
    date: d.date,
    customerName: d.customerName || "No customer yet",
    total: round2(d.totals?.total || 0),
    balance: round2(d.balance || 0),
    payStatus: d.payStatus || "unpaid",
    status: d.status || "draft",
  }));
}

export async function draftCount(): Promise<number> {
  const col = await invoices();
  return col.countDocuments({ deleted: { $ne: true }, status: "draft" });
}

/** Sales for the same calendar month a year apart, for the "vs last year" line. */
export async function monthlyProfit(year: string): Promise<SeriesPoint[]> {
  return (await series({ from: `${year}-01-01`, to: `${year}-12-31` })).points;
}

export function currentYear(): string {
  return today().slice(0, 4);
}
