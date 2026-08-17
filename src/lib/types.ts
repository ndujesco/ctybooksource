import type { ObjectId } from "mongodb";

export const CURRENCY = "₦";

/* ---------------------------------------------------------------------------
   Books

   Deliberately NO stock tracking. Selling a book never decrements anything —
   the catalogue is just names + prices. Every book carries a short name (what
   prints on the invoice by default) and a full name (the official title).
   ------------------------------------------------------------------------ */

export type BookDoc = {
  _id?: ObjectId;
  name: string;
  publisher: string;
  category: string; // kept for the by-subject report; not captured on new books
  costPrice: number; // what we buy it for
  sellingPrice: number; // default price on an invoice line
  archived: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type Book = {
  id: string;
  name: string;
  publisher: string;
  category: string;
  costPrice: number;
  sellingPrice: number;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
};

/* ---------------------------------------------------------------------------
   Customers (schools, bookshops)
   ------------------------------------------------------------------------ */

export type CustomerDoc = {
  _id?: ObjectId;
  name: string; // school / business name
  phone: string;
  address: string;
  notes: string;
  archived: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type Customer = {
  id: string;
  name: string;
  phone: string;
  address: string;
  notes: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
};

/* ---------------------------------------------------------------------------
   Invoices

   Lines snapshot the book's name and prices at the time of sale, so editing a
   book later never rewrites history (and profit stays correct).
   ------------------------------------------------------------------------ */

export type Line = {
  id: string;
  bookId: string | null;
  name: string; // what prints on this line
  publisher: string;
  category: string;
  qty: number;
  unitPrice: number; // selling price at time of sale
  costPrice: number; // cost at time of sale — drives profit
};

export type PaymentMethod = "Cash" | "Transfer" | "POS" | "Cheque" | "Other";

export const PAYMENT_METHODS: PaymentMethod[] = [
  "Cash",
  "Transfer",
  "POS",
  "Cheque",
  "Other",
];

export type Payment = {
  id: string;
  amount: number;
  method: PaymentMethod;
  date: string; // yyyy-mm-dd
  note: string;
};

// Lifecycle of the document itself.
export type InvoiceStatus = "draft" | "open" | "cancelled";
// Derived from money — never typed by the user.
export type PayStatus = "paid" | "partial" | "unpaid";

export type Totals = {
  subtotal: number; // sum of line totals, before discount
  discount: number; // naira taken off by the whole-invoice discount
  total: number; // grand total = subtotal - discount
  cost: number; // sum of qty * costPrice
  profit: number; // total - cost
  qty: number; // total books on the invoice
};

export type InvoiceDoc = {
  _id?: ObjectId;
  number: number; // sequential, from the `counters` collection
  customerId: string | null;
  customerName: string; // snapshot — survives customer rename/delete
  customerPhone: string;
  customerAddress: string;
  lines: Line[];
  date: string; // yyyy-mm-dd — the business date of the sale
  discountPercent: number;
  payments: Payment[];
  notes: string;
  status: InvoiceStatus;
  // Derived and recomputed server-side on every write. Stored so that list
  // filtering and the analytics pipelines stay simple and fast.
  totals: Totals;
  amountPaid: number;
  balance: number;
  payStatus: PayStatus;
  deleted: boolean;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type Invoice = Omit<
  InvoiceDoc,
  "_id" | "deletedAt" | "createdAt" | "updatedAt"
> & {
  id: string;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/* ---------------------------------------------------------------------------
   Money maths — one place, shared by the editor, the printed invoice and the
   server-side recompute.
   ------------------------------------------------------------------------ */

export function lineTotal(l: Pick<Line, "qty" | "unitPrice">): number {
  return (Number(l.qty) || 0) * (Number(l.unitPrice) || 0);
}

export function lineCost(l: Pick<Line, "qty" | "costPrice">): number {
  return (Number(l.qty) || 0) * (Number(l.costPrice) || 0);
}

export function clampPercent(p: number): number {
  if (!Number.isFinite(p)) return 0;
  return Math.min(100, Math.max(0, p));
}

export function computeTotals(lines: Line[], discountPercent: number): Totals {
  const subtotal = lines.reduce((s, l) => s + lineTotal(l), 0);
  const discount = subtotal * (clampPercent(discountPercent) / 100);
  const total = round2(subtotal - discount);
  const cost = lines.reduce((s, l) => s + lineCost(l), 0);
  return {
    subtotal: round2(subtotal),
    discount: round2(discount),
    total,
    cost: round2(cost),
    profit: round2(total - cost),
    qty: lines.reduce((s, l) => s + (Number(l.qty) || 0), 0),
  };
}

export function sumPayments(payments: Payment[]): number {
  return round2(
    (payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0)
  );
}

export function derivePayStatus(total: number, paid: number): PayStatus {
  if (paid <= 0) return "unpaid";
  // Tolerate sub-kobo float noise so "paid in full" actually reads as paid.
  if (paid + 0.005 >= total) return "paid";
  return "partial";
}

export function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** The name that prints on the invoice for this line. */
export function lineName(l: Line): string {
  return (l.name || "").trim() || "Item";
}

/** Display label for a book in pickers and reports. */
export function bookLabel(b: Pick<Book, "name">): string {
  return (b.name || "").trim() || "Untitled";
}

export function invoiceNumberLabel(n: number): string {
  return `INV-${String(n).padStart(4, "0")}`;
}

export const PAY_STATUS_LABEL: Record<PayStatus, string> = {
  paid: "Paid",
  partial: "Part paid",
  unpaid: "Unpaid",
};

export function formatMoney(n: number): string {
  return (
    CURRENCY +
    (Number(n) || 0).toLocaleString("en-NG", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    })
  );
}

/**
 * Compact money for dashboard tiles: ₦2.4m, ₦1.02m, ₦450k.
 *
 * Single-digit millions get two decimals — at one decimal, ₦1,019,362 and
 * ₦1,040,000 both read as "₦1m", which is too much detail to lose on a tile
 * someone makes decisions from.
 */
export function formatMoneyShort(n: number): string {
  const v = Number(n) || 0;
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 10_000_000) return `${sign}${CURRENCY}${trim(abs / 1_000_000, 1)}m`;
  if (abs >= 1_000_000) return `${sign}${CURRENCY}${trim(abs / 1_000_000, 2)}m`;
  if (abs >= 10_000) return `${sign}${CURRENCY}${trim(abs / 1000, 1)}k`;
  return formatMoney(v);
}

function trim(n: number, places: number): string {
  const f = Math.pow(10, places);
  return (Math.round(n * f) / f).toString();
}

export function formatPercent(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`;
}
