"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AgingBar, RankBars, TimeChart } from "@/components/charts";
import { getAnalytics } from "@/lib/client";
import { formatMoney, formatMoneyShort, invoiceNumberLabel } from "@/lib/types";
import { formatDate, formatRange, relativeDays, type Period, type Range } from "@/lib/datetime";
import { AGE_COLORS, spineColor } from "@/lib/spine";
import {
  Delta,
  ErrorNote,
  Loading,
  Money,
  PageHeader,
  Section,
  Segmented,
  Stat,
} from "@/components/ui";

type Kpi = {
  sales: number; collected: number; outstanding: number; invoiceCount: number;
  customerCount: number; qty: number; cost: number; profit: number; margin: number; avgInvoice: number;
};
type ProductRow = {
  bookId: string | null; name: string; publisher: string; category: string;
  qty: number; revenue: number; profit: number; orders: number;
  lastSold: string | null; daysSinceSold: number | null;
};
type CustomerRow = {
  customerId: string | null; name: string; revenue: number; orders: number; qty: number;
  paid: number; owed: number; profit: number; avgOrder: number;
  lastPurchase: string | null; daysSincePurchase: number | null;
};
type GroupRow = { key: string; qty: number; revenue: number; cost: number; profit: number; margin: number; share: number };
type DebtRow = {
  invoiceId: string; number: number; date: string; customerId: string | null;
  customerName: string; total: number; paid: number; balance: number; ageDays: number;
};

type Analytics = {
  range: Range;
  kpi: Kpi;
  previous: Kpi;
  growth: { sales: number | null; collected: number | null; profit: number | null; invoices: number | null };
  series: { bucket: string; points: { key: string; label: string; sales: number; collected: number }[] };
  products: { top: ProductRow[]; slow: ProductRow[]; staleDays: number };
  customers: { top: CustomerRow[]; dormant: CustomerRow[]; quietDays: number };
  debt: {
    totalOutstanding: number; invoiceCount: number; customerCount: number;
    aging: { label: string; amount: number; count: number }[];
    oldest: DebtRow[]; largest: DebtRow[]; topDebtors: CustomerRow[];
  };
  profit: { revenue: number; cost: number; gross: number; margin: number; byPublisher: GroupRow[]; byCategory: GroupRow[] };
};

type Tab = "sales" | "books" | "schools" | "debt" | "profit";
type Rank = "revenue" | "qty" | "profit";

const PERIODS: { value: Period; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "year", label: "Year" },
  { value: "all", label: "All time" },
  { value: "custom", label: "Custom" },
];

const TABS: { value: Tab; label: string }[] = [
  { value: "sales", label: "Sales" },
  { value: "books", label: "Books" },
  { value: "schools", label: "Schools" },
  { value: "debt", label: "Debt" },
  { value: "profit", label: "Profit" },
];

const RANKS: { value: Rank; label: string }[] = [
  { value: "revenue", label: "By revenue" },
  { value: "qty", label: "By quantity" },
  { value: "profit", label: "By profit" },
];

export default function ReportsView() {
  const params = useSearchParams();
  const [tab, setTab] = useState<Tab>((params.get("tab") as Tab) || "sales");
  const [period, setPeriod] = useState<Period>("month");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [rank, setRank] = useState<Rank>("revenue");

  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    const q: Record<string, string> = { period };
    if (period === "custom") {
      if (from) q.from = from;
      if (to) q.to = to;
    }
    getAnalytics<Analytics>(q)
      .then((d) => {
        setError("");
        setData(d);
      })
      .catch((e: Error) => setError(e.message));
  }, [period, from, to]);

  useEffect(load, [load]);

  return (
    <main>
      <PageHeader title="Reports" subtitle="Drafts and cancelled invoices are left out of every figure here." />

      <div className="no-print sticky top-0 z-30 space-y-2 border-b border-[var(--rule)] bg-[var(--paper)]/95 px-4 pb-3 backdrop-blur">
        <Segmented label="Report" value={tab} options={TABS} onChange={setTab} />
        <Segmented label="Period" value={period} options={PERIODS} onChange={setPeriod} />
        {period === "custom" && (
          <div className="flex items-center gap-2">
            <input type="date" className="field" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
            <span className="text-[var(--ink-3)]">to</span>
            <input type="date" className="field" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
          </div>
        )}
      </div>

      {error && (
        <div className="px-4 pt-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
      {!data && !error && <Loading label="Adding it up" />}

      {data && (
        <>
          <p className="px-4 pt-3 text-xs text-[var(--ink-3)]">{formatRange(data.range)}</p>

          {tab === "sales" && <SalesTab data={data} />}
          {tab === "books" && <BooksTab data={data} rank={rank} setRank={setRank} />}
          {tab === "schools" && <SchoolsTab data={data} rank={rank} setRank={setRank} />}
          {tab === "debt" && <DebtTab data={data} />}
          {tab === "profit" && <ProfitTab data={data} rank={rank} setRank={setRank} />}
        </>
      )}
    </main>
  );
}

/* -- Sales ---------------------------------------------------------------- */

function SalesTab({ data }: { data: Analytics }) {
  const k = data.kpi;
  return (
    <>
      <section className="px-4 py-4">
        <p className="eyebrow">Sales invoiced</p>
        <p className="figure mt-1 text-[2.5rem] leading-none">{formatMoney(k.sales)}</p>
        <p className="mt-1.5 text-sm text-[var(--ink-2)]">
          <Delta value={data.growth.sales} /> vs {formatMoneyShort(data.previous.sales)} the period
          before
        </p>
      </section>

      <Section title="Over time">
        <div className="card px-3 pt-3 pb-3">
          <TimeChart points={data.series.points} />
        </div>
      </Section>

      <Section title="The period in figures">
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Collected" value={formatMoneyShort(k.collected)} tone="credit" sub={<Delta value={data.growth.collected} />} />
          <Stat
            label="Still owed"
            value={formatMoneyShort(k.outstanding)}
            tone="debit"
            sub="on invoices raised in this period"
          />
          <Stat label="Invoices" value={String(k.invoiceCount)} sub={<Delta value={data.growth.invoices} />} />
          <Stat label="Average invoice" value={formatMoneyShort(k.avgInvoice)} />
          <Stat label="Books sold" value={k.qty.toLocaleString()} />
          <Stat label="Schools served" value={String(k.customerCount)} />
          <Stat label="Est. profit" value={formatMoneyShort(k.profit)} sub={<Delta value={data.growth.profit} />} />
          <Stat label="Margin" value={`${k.margin.toFixed(1)}%`} sub={`cost ${formatMoneyShort(k.cost)}`} />
        </div>
      </Section>
    </>
  );
}

/* -- Books ---------------------------------------------------------------- */

function BooksTab({ data, rank, setRank }: { data: Analytics; rank: Rank; setRank: (r: Rank) => void }) {
  const rows = [...data.products.top].sort((a, b) => b[rank] - a[rank]).slice(0, 20);

  return (
    <>
      <Section title="Best sellers" action={<Segmented label="Rank by" value={rank} options={RANKS} onChange={setRank} />}>
        <div className="card px-3.5 py-3.5">
          <RankBars
            emptyLabel="No books sold in this period."
            rows={rows.map((p) => ({
              key: p.bookId ?? p.name,
              label: p.name,
              value: p[rank],
              color: spineColor(p.publisher),
              display:
                rank === "qty" ? `${p.qty} sold` : formatMoney(p[rank]),
              sub:
                rank === "qty"
                  ? formatMoneyShort(p.revenue)
                  : `${p.qty} sold`,
            }))}
          />
        </div>
        {rows.length > 0 && (
          <details className="card mt-2 px-3.5 py-3">
            <summary className="cursor-pointer text-sm font-medium">Show as a table</summary>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--rule)]">
                    <th className="eyebrow py-1.5 text-left">Book</th>
                    <th className="eyebrow py-1.5 text-right">Qty</th>
                    <th className="eyebrow py-1.5 text-right">Revenue</th>
                    <th className="eyebrow py-1.5 text-right">Profit</th>
                  </tr>
                </thead>
                <tbody className="ruled">
                  {rows.map((p) => (
                    <tr key={p.bookId ?? p.name}>
                      <td className="max-w-[9rem] truncate py-1.5">{p.name}</td>
                      <td className="figure py-1.5 text-right">{p.qty}</td>
                      <td className="figure py-1.5 text-right">{formatMoneyShort(p.revenue)}</td>
                      <td className="figure py-1.5 text-right text-[var(--credit)]">
                        {formatMoneyShort(p.profit)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </Section>

      <Section
        title="Not moving"
        note={`nothing sold in ${data.products.staleDays}+ days`}
      >
        {data.products.slow.length === 0 ? (
          <p className="card px-3.5 py-4 text-sm text-[var(--ink-2)]">
            Every book on the shelf has sold recently.
          </p>
        ) : (
          <ul className="card ruled overflow-hidden">
            {data.products.slow.map((p) => (
              <li key={p.bookId ?? p.name} className="flex items-center gap-3 px-3.5 py-2.5">
                <span className="spine" style={{ background: spineColor(p.publisher) }} aria-hidden />
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{p.name}</span>
                  <span className="block truncate text-xs text-[var(--ink-3)]">
                    {p.publisher || "No publisher"}
                  </span>
                </div>
                <span className="shrink-0 text-right text-xs">
                  <span className="block" style={{ color: p.lastSold ? "var(--pending)" : "var(--debit)" }}>
                    {p.lastSold ? relativeDays(p.lastSold) : "never sold"}
                  </span>
                  <span className="figure block text-[var(--ink-3)]">{p.qty} sold all time</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="By publisher">
        <div className="card px-3.5 py-3.5">
          <RankBars
            emptyLabel="No sales in this period."
            rows={data.profit.byPublisher.map((g) => ({
              key: g.key,
              label: g.key,
              value: g.revenue,
              color: spineColor(g.key === "Unspecified" ? "" : g.key),
              sub: `${g.share.toFixed(0)}% · ${g.qty} books`,
            }))}
          />
        </div>
      </Section>

      <Section title="By subject">
        <div className="card px-3.5 py-3.5">
          <RankBars
            emptyLabel="No sales in this period."
            rows={data.profit.byCategory.map((g) => ({
              key: g.key,
              label: g.key,
              value: g.revenue,
              sub: `${g.qty} books`,
            }))}
          />
        </div>
      </Section>
    </>
  );
}

/* -- Schools -------------------------------------------------------------- */

function SchoolsTab({ data, rank, setRank }: { data: Analytics; rank: Rank; setRank: (r: Rank) => void }) {
  const key = rank === "qty" ? "orders" : rank === "profit" ? "profit" : "revenue";
  const rows = [...data.customers.top]
    .sort((a, b) => (b[key] as number) - (a[key] as number))
    .slice(0, 20);

  return (
    <>
      <Section
        title="Top schools"
        action={
          <Segmented
            label="Rank by"
            value={rank}
            options={[
              { value: "revenue", label: "By spend" },
              { value: "qty", label: "By orders" },
              { value: "profit", label: "By profit" },
            ]}
            onChange={setRank}
          />
        }
      >
        <div className="card px-3.5 py-3.5">
          <RankBars
            emptyLabel="No purchases in this period."
            rows={rows.map((c) => ({
              key: c.customerId ?? c.name,
              label: c.name,
              value: c[key] as number,
              display: key === "orders" ? `${c.orders} orders` : formatMoney(c[key] as number),
              sub: c.owed > 0.01 ? `${formatMoneyShort(c.owed)} owing` : "settled",
            }))}
          />
        </div>
        {rows.length > 0 && (
          <ul className="ruled mt-2">
            {rows.slice(0, 10).map((c) =>
              c.customerId ? (
                <li key={c.customerId}>
                  <Link
                    href={`/customers/${c.customerId}`}
                    className="flex items-center justify-between gap-3 py-2 text-sm hover:text-[var(--gold)]"
                  >
                    <span className="truncate underline-offset-2 hover:underline">{c.name}</span>
                    <span className="figure shrink-0 text-xs text-[var(--ink-3)]">
                      {c.orders} orders · {formatMoneyShort(c.avgOrder)} avg
                    </span>
                  </Link>
                </li>
              ) : null
            )}
          </ul>
        )}
      </Section>

      <Section title="Gone quiet" note={`no purchase in ${data.customers.quietDays}+ days`}>
        {data.customers.dormant.length === 0 ? (
          <p className="card px-3.5 py-4 text-sm text-[var(--ink-2)]">
            Every school has bought something recently.
          </p>
        ) : (
          <ul className="card ruled overflow-hidden">
            {data.customers.dormant.map((c) => (
              <li key={c.customerId ?? c.name}>
                <LinkOrText customerId={c.customerId}>
                  <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                    <div className="min-w-0">
                      <span className="block truncate text-sm font-medium">{c.name}</span>
                      <span className="figure block text-xs text-[var(--ink-3)]">
                        {c.revenue > 0 ? `${formatMoneyShort(c.revenue)} lifetime` : "never bought"}
                      </span>
                    </div>
                    <span
                      className="shrink-0 text-xs"
                      style={{ color: c.lastPurchase ? "var(--pending)" : "var(--debit)" }}
                    >
                      {c.lastPurchase ? relativeDays(c.lastPurchase) : "no invoices"}
                    </span>
                  </div>
                </LinkOrText>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

function LinkOrText({ customerId, children }: { customerId: string | null; children: React.ReactNode }) {
  return customerId ? (
    <Link href={`/customers/${customerId}`} className="block hover:bg-[var(--sunken)]">
      {children}
    </Link>
  ) : (
    <>{children}</>
  );
}

/* -- Debt ----------------------------------------------------------------- */

function DebtTab({ data }: { data: Analytics }) {
  const d = data.debt;
  return (
    <>
      <section className="px-4 py-4">
        <p className="eyebrow">Total outstanding</p>
        <p className="figure mt-1 text-[2.5rem] leading-none text-[var(--debit)]">
          {formatMoney(d.totalOutstanding)}
        </p>
        <p className="mt-1.5 text-sm text-[var(--ink-2)]">
          Across {d.invoiceCount} {d.invoiceCount === 1 ? "invoice" : "invoices"} from{" "}
          {d.customerCount} {d.customerCount === 1 ? "school" : "schools"}. This is all-time, not
          just the selected period.
        </p>
      </section>

      <Section title="How old the debt is">
        <div className="card px-3.5 py-3.5">
          <AgingBar buckets={d.aging} colors={AGE_COLORS} />
        </div>
      </Section>

      <Section title="Who owes the most">
        <div className="card px-3.5 py-3.5">
          <RankBars
            emptyLabel="Nobody owes anything."
            rows={d.topDebtors.map((c) => ({
              key: c.customerId ?? c.name,
              label: c.name,
              value: c.owed,
              color: "var(--debit)",
              sub: `${c.orders} unpaid`,
            }))}
          />
        </div>
      </Section>

      <Section title="Oldest unpaid invoices">
        <DebtList rows={d.oldest} />
      </Section>

      <Section title="Largest balances">
        <DebtList rows={d.largest} />
      </Section>
    </>
  );
}

function DebtList({ rows }: { rows: DebtRow[] }) {
  if (rows.length === 0) {
    return <p className="card px-3.5 py-4 text-sm text-[var(--ink-2)]">Nothing outstanding.</p>;
  }
  return (
    <ul className="card ruled overflow-hidden">
      {rows.map((r) => (
        <li key={r.invoiceId}>
          <Link href={`/invoices/${r.invoiceId}`} className="flex items-center gap-3 px-3.5 py-2.5 hover:bg-[var(--sunken)]">
            <div className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{r.customerName}</span>
              <span className="figure block text-xs text-[var(--ink-3)]">
                {invoiceNumberLabel(r.number)} · {formatDate(r.date)} · {r.ageDays} days
              </span>
            </div>
            <div className="shrink-0 text-right">
              <Money value={r.balance} tone="debit" className="text-sm" />
              <span className="figure block text-xs text-[var(--ink-3)]">
                of {formatMoneyShort(r.total)}
              </span>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/* -- Profit --------------------------------------------------------------- */

function ProfitTab({ data, rank, setRank }: { data: Analytics; rank: Rank; setRank: (r: Rank) => void }) {
  const p = data.profit;
  const byProfit = rank === "profit";
  const metric = byProfit ? "profit" : "revenue";

  return (
    <>
      <section className="px-4 py-4">
        <p className="eyebrow">Gross profit</p>
        <p className="figure mt-1 text-[2.5rem] leading-none text-[var(--credit)]">
          {formatMoney(p.gross)}
        </p>
        <p className="mt-1.5 text-sm text-[var(--ink-2)]">
          {p.margin.toFixed(1)}% margin · <Delta value={data.growth.profit} /> vs the period before
        </p>
      </section>

      <Section title="Where it comes from">
        <div className="card px-3.5 py-3.5">
          {/* Revenue split into what it cost and what was left — one bar, two
              parts, so the margin is the thing you actually see. */}
          <div className="flex h-3 gap-[2px] overflow-hidden rounded-full">
            <div
              className="h-full rounded-l-full"
              style={{ width: `${p.revenue > 0 ? (p.cost / p.revenue) * 100 : 0}%`, background: "var(--ink-3)" }}
            />
            <div
              className="h-full rounded-r-full"
              style={{ width: `${p.revenue > 0 ? (p.gross / p.revenue) * 100 : 100}%`, background: "var(--credit)" }}
            />
          </div>
          <ul className="ruled mt-3">
            <li className="flex items-center justify-between py-2 text-sm">
              <span className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-sm bg-[var(--ink-3)]" />
                What the books cost you
              </span>
              <Money value={p.cost} className="text-sm" />
            </li>
            <li className="flex items-center justify-between py-2 text-sm">
              <span className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: "var(--credit)" }} />
                Gross profit
              </span>
              <Money value={p.gross} tone="credit" className="text-sm" />
            </li>
            <li className="flex items-center justify-between py-2 text-sm font-semibold">
              <span>Revenue</span>
              <Money value={p.revenue} className="text-sm" />
            </li>
          </ul>
          <p className="mt-2 text-xs text-[var(--ink-3)]">
            Profit assumes the cost price recorded on each book at the time it was sold. Books with
            no cost price recorded count as pure profit — fill those in on the Books tab.
          </p>
        </div>
      </Section>

      <Section
        title="Profit by publisher"
        action={
          <Segmented
            label="Show"
            value={rank}
            options={[
              { value: "revenue", label: "Revenue" },
              { value: "profit", label: "Profit" },
            ]}
            onChange={setRank}
          />
        }
      >
        <div className="card px-3.5 py-3.5">
          <RankBars
            emptyLabel="No sales in this period."
            rows={p.byPublisher.map((g) => ({
              key: g.key,
              label: g.key,
              value: g[metric],
              color: spineColor(g.key === "Unspecified" ? "" : g.key),
              sub: `${g.margin.toFixed(0)}% margin`,
            }))}
          />
        </div>
      </Section>

      <Section title="Profit by subject">
        <div className="card px-3.5 py-3.5">
          <RankBars
            emptyLabel="No sales in this period."
            rows={p.byCategory.map((g) => ({
              key: g.key,
              label: g.key,
              value: g[metric],
              sub: `${g.margin.toFixed(0)}% margin`,
            }))}
          />
        </div>
      </Section>

      <Section title="Most profitable books">
        <div className="card px-3.5 py-3.5">
          <RankBars
            emptyLabel="No books sold in this period."
            rows={[...data.products.top]
              .sort((a, b) => b.profit - a.profit)
              .slice(0, 15)
              .map((b) => ({
                key: b.bookId ?? b.name,
                label: b.name,
                value: b.profit,
                color: spineColor(b.publisher),
                sub: `${b.qty} sold`,
              }))}
          />
        </div>
      </Section>
    </>
  );
}
