"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Settings, Sparkles } from "lucide-react";
import { createInvoice, getOverview } from "@/lib/client";
import { formatMoney, formatMoneyShort, invoiceNumberLabel } from "@/lib/types";
import { formatDate, formatMonthLong, today } from "@/lib/datetime";
import { AGE_COLORS } from "@/lib/spine";
import { AgingBar } from "@/components/charts";
import ImportSheet from "@/components/ImportSheet";
import {
  Delta,
  Empty,
  ErrorNote,
  Loading,
  Money,
  Section,
  Stat,
  StatusPill,
} from "@/components/ui";
import type { PayStatus } from "@/lib/types";

type Kpi = {
  sales: number;
  collected: number;
  outstanding: number;
  invoiceCount: number;
  customerCount: number;
  qty: number;
  profit: number;
  margin: number;
  avgInvoice: number;
};

type Overview = {
  today: Kpi;
  month: Kpi & { salesGrowth: number | null; profitGrowth: number | null; previousSales: number };
  year: Kpi;
  debt: {
    totalOutstanding: number;
    invoiceCount: number;
    customerCount: number;
    aging: { label: string; amount: number; count: number }[];
    topDebtors: { customerId: string | null; name: string; owed: number }[];
  };
  recent: {
    id: string;
    number: number;
    date: string;
    customerName: string;
    total: number;
    balance: number;
    payStatus: PayStatus;
    status: "draft" | "open" | "cancelled";
  }[];
  drafts: number;
};

export default function LedgerView() {
  const router = useRouter();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);

  const load = useCallback(() => {
    getOverview<Overview>()
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(load, [load]);

  async function newInvoice() {
    setCreating(true);
    try {
      const inv = await createInvoice({ date: today() });
      router.push(`/invoices/${inv.id}`);
    } catch (e) {
      setError((e as Error).message);
      setCreating(false);
    }
  }

  const monthName = formatMonthLong(today().slice(0, 7));

  return (
    <main>
      {/* The masthead of a ledger page: whose book this is, and what day it is. */}
      <header className="no-print flex items-start justify-between gap-3 border-b border-[var(--rule)] px-4 pt-6 pb-4">
        <div>
          <p className="eyebrow">{formatDate(today())}</p>
          <h1 className="display mt-1 text-[1.9rem] leading-none">CTY Booksource</h1>
        </div>
        <Link
          href="/settings"
          aria-label="Settings"
          className="mt-1 rounded-lg p-2 text-[var(--ink-2)] hover:bg-[var(--sunken)]"
        >
          <Settings size={20} />
        </Link>
      </header>

      {error && (
        <div className="px-4 pt-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      {!data && !error && <Loading label="Opening the ledger" />}

      {data && (
        <>
          {/* Today — the single most-asked question, so it gets the hero slot. */}
          <section className="border-b border-[var(--rule)] px-4 py-5">
            <div className="flex items-baseline justify-between">
              <span className="eyebrow">Today&rsquo;s takings</span>
              <span className="text-xs text-[var(--ink-2)]">
                {data.today.invoiceCount}{" "}
                {data.today.invoiceCount === 1 ? "invoice" : "invoices"}
              </span>
            </div>
            <p className="figure mt-1 text-[2.75rem] leading-none">
              {formatMoney(data.today.sales)}
            </p>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
              <span className="text-[var(--ink-2)]">
                Collected <Money value={data.today.collected} tone="credit" />
              </span>
              <span className="text-[var(--ink-2)]">
                Still owed <Money value={data.today.outstanding} tone="debit" />
              </span>
              <span className="text-[var(--ink-2)]">
                Books out <span className="figure text-[var(--ink)]">{data.today.qty}</span>
              </span>
            </div>

            <div className="mt-4 flex gap-2">
              <button className="btn btn-ink flex-1" onClick={newInvoice} disabled={creating}>
                <Plus size={18} /> {creating ? "Opening…" : "New invoice"}
              </button>
              <button
                className="btn btn-quiet"
                onClick={() => setImporting(true)}
                aria-label="Build an invoice from a list"
              >
                <Sparkles size={17} /> From a list
              </button>
            </div>
            {data.drafts > 0 && (
              <Link
                href="/invoices?status=draft"
                className="mt-2 block text-center text-xs text-[var(--gold)] underline underline-offset-2"
              >
                {data.drafts} unfinished {data.drafts === 1 ? "draft" : "drafts"} — not counted in
                any total
              </Link>
            )}
          </section>

          <Section title={monthName} note={`vs ${formatMoneyShort(data.month.previousSales)} last month`}>
            <div className="grid grid-cols-2 gap-2">
              <Stat
                label="Sales"
                value={formatMoneyShort(data.month.sales)}
                sub={<Delta value={data.month.salesGrowth} />}
              />
              <Stat
                label="Collected"
                value={formatMoneyShort(data.month.collected)}
                tone="credit"
                sub={`${data.month.invoiceCount} invoices`}
              />
              <Stat
                label="Est. profit"
                value={formatMoneyShort(data.month.profit)}
                sub={
                  <span>
                    {data.month.margin.toFixed(1)}% margin · <Delta value={data.month.profitGrowth} />
                  </span>
                }
              />
              <Stat
                label="Schools served"
                value={String(data.month.customerCount)}
                sub={`${data.month.qty} books`}
              />
            </div>
          </Section>

          <Section title="Owed to you" action={<Link href="/reports?tab=debt" className="text-xs text-[var(--gold)] underline underline-offset-2">Full list</Link>}>
            <div className="card px-3.5 py-3.5">
              <div className="flex items-baseline justify-between">
                <span className="figure text-[1.75rem] leading-none text-[var(--debit)]">
                  {formatMoney(data.debt.totalOutstanding)}
                </span>
                <span className="text-xs text-[var(--ink-2)]">
                  {data.debt.customerCount} {data.debt.customerCount === 1 ? "school" : "schools"} ·{" "}
                  {data.debt.invoiceCount} invoices
                </span>
              </div>
              <div className="mt-3">
                <AgingBar buckets={data.debt.aging} colors={AGE_COLORS} />
              </div>
              {data.debt.topDebtors.length > 0 && (
                <ul className="ruled mt-1 border-t border-[var(--rule)]">
                  {data.debt.topDebtors.map((d) => (
                    <li key={d.customerId ?? d.name} className="flex items-center justify-between gap-3 py-2">
                      {d.customerId ? (
                        <Link href={`/customers/${d.customerId}`} className="truncate text-sm underline-offset-2 hover:underline">
                          {d.name}
                        </Link>
                      ) : (
                        <span className="truncate text-sm">{d.name}</span>
                      )}
                      <Money value={d.owed} tone="debit" className="shrink-0 text-sm" />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Section>

          <Section title="This year" note={formatDate(today()).slice(-4)}>
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Total sales" value={formatMoneyShort(data.year.sales)} />
              <Stat label="Total profit" value={formatMoneyShort(data.year.profit)} sub={`${data.year.margin.toFixed(1)}% margin`} />
              <Stat label="Books sold" value={data.year.qty.toLocaleString()} />
              <Stat label="Customers" value={String(data.year.customerCount)} sub={`${data.year.invoiceCount} invoices`} />
            </div>
          </Section>

          <Section
            title="Latest entries"
            action={
              <Link href="/invoices" className="text-xs text-[var(--gold)] underline underline-offset-2">
                All invoices
              </Link>
            }
          >
            {data.recent.length === 0 ? (
              <Empty
                title="The ledger is empty"
                hint="Write the first invoice and everything else on this screen fills itself in."
                action={
                  <button className="btn btn-ink" onClick={newInvoice}>
                    <Plus size={18} /> New invoice
                  </button>
                }
              />
            ) : (
              <ul className="card ruled overflow-hidden">
                {data.recent.map((r) => (
                  <li key={r.id}>
                    <Link href={`/invoices/${r.id}`} className="flex items-center gap-3 px-3.5 py-3 hover:bg-[var(--sunken)]">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium">{r.customerName}</span>
                          <StatusPill payStatus={r.payStatus} status={r.status} />
                        </div>
                        <div className="figure mt-0.5 text-xs text-[var(--ink-3)]">
                          {invoiceNumberLabel(r.number)} · {formatDate(r.date)}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <Money value={r.total} />
                        {r.balance > 0.01 && (
                          <div className="text-xs text-[var(--debit)]">
                            {formatMoney(r.balance)} owing
                          </div>
                        )}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </>
      )}

      {importing && <ImportSheet onClose={() => setImporting(false)} />}
    </main>
  );
}
