"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, Search, SlidersHorizontal, Sparkles, Trash2 } from "lucide-react";
import { createInvoice, listInvoices } from "@/lib/client";
import { formatMoney, invoiceNumberLabel, type Invoice } from "@/lib/types";
import { formatDate, today } from "@/lib/datetime";
import ImportSheet from "@/components/ImportSheet";
import { Empty, ErrorNote, Loading, Money, PageHeader, Segmented, StatusPill } from "@/components/ui";

type Filter = "all" | "unpaid" | "partial" | "paid" | "draft" | "cancelled";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "unpaid", label: "Unpaid" },
  { value: "partial", label: "Part paid" },
  { value: "paid", label: "Paid" },
  { value: "draft", label: "Drafts" },
  { value: "cancelled", label: "Cancelled" },
];

export default function InvoicesView() {
  const router = useRouter();
  const params = useSearchParams();

  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>(
    (params.get("status") as Filter) || (params.get("pay") as Filter) || "all"
  );
  const [from, setFrom] = useState(params.get("from") || "");
  const [to, setTo] = useState(params.get("to") || "");
  const [showDates, setShowDates] = useState(Boolean(params.get("from") || params.get("to")));

  const [rows, setRows] = useState<Invoice[] | null>(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);

  const load = useCallback(() => {
    setError("");
    const isDocStatus = filter === "draft" || filter === "cancelled";
    listInvoices({
      q,
      pay: isDocStatus || filter === "all" ? undefined : filter,
      status: isDocStatus ? filter : undefined,
      from,
      to,
      limit: 400,
    })
      .then(setRows)
      .catch((e: Error) => setError(e.message));
  }, [q, filter, from, to]);

  // Debounce so typing a school name doesn't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  const summary = useMemo(() => {
    const list = (rows || []).filter((r) => r.status === "open");
    return {
      count: list.length,
      total: list.reduce((s, r) => s + r.totals.total, 0),
      paid: list.reduce((s, r) => s + r.amountPaid, 0),
      owed: list.reduce((s, r) => s + r.balance, 0),
    };
  }, [rows]);

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

  return (
    <main>
      <PageHeader
        title="Invoices"
        subtitle="Search by school, or type an invoice number."
        action={
          <Link
            href="/invoices/trash"
            aria-label="Deleted invoices"
            className="mt-1 rounded-lg p-2 text-[var(--ink-2)] hover:bg-[var(--sunken)]"
          >
            <Trash2 size={19} />
          </Link>
        }
      />

      <div className="no-print sticky top-0 z-30 space-y-2.5 border-b border-[var(--rule)] bg-[var(--paper)]/95 px-4 pb-3 backdrop-blur">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search
              size={16}
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[var(--ink-3)]"
            />
            <input
              className="field pl-9"
              placeholder="ABC School, or INV-0042"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search invoices"
            />
          </div>
          <button
            className="btn btn-quiet px-3"
            aria-label="Date range"
            aria-pressed={showDates}
            onClick={() => setShowDates((v) => !v)}
          >
            <SlidersHorizontal size={17} />
          </button>
          <button
            className="btn btn-quiet px-3"
            onClick={() => setImporting(true)}
            aria-label="Build an invoice from a list"
          >
            <Sparkles size={17} />
          </button>
          <button className="btn btn-ink px-3" onClick={newInvoice} disabled={creating} aria-label="New invoice">
            <Plus size={18} />
          </button>
        </div>

        <Segmented label="Payment status" value={filter} options={FILTERS} onChange={setFilter} />

        {showDates && (
          <div className="flex items-center gap-2 text-sm">
            <input
              type="date"
              className="field"
              value={from}
              max={to || undefined}
              onChange={(e) => setFrom(e.target.value)}
              aria-label="From date"
            />
            <span className="text-[var(--ink-3)]">to</span>
            <input
              type="date"
              className="field"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
              aria-label="To date"
            />
            {(from || to) && (
              <button
                className="btn btn-quiet px-2 text-xs"
                onClick={() => {
                  setFrom("");
                  setTo("");
                }}
              >
                Clear
              </button>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="px-4 pt-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
      {!rows && !error && <Loading label="Loading invoices" />}

      {rows && rows.length > 0 && (
        <>
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-[var(--rule)] bg-[var(--sunken)] px-4 py-2.5 text-xs text-[var(--ink-2)]">
            <span>
              <span className="figure text-[var(--ink)]">{summary.count}</span> invoices
            </span>
            <span>
              Total <Money value={summary.total} className="text-[0.75rem]" />
            </span>
            <span>
              Paid <Money value={summary.paid} tone="credit" className="text-[0.75rem]" />
            </span>
            <span>
              Owed <Money value={summary.owed} tone="debit" className="text-[0.75rem]" />
            </span>
          </div>

          <ul className="ruled">
            {rows.map((r) => (
              <li key={r.id}>
                <Link href={`/invoices/${r.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-[var(--sunken)]">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">
                        {r.customerName || <span className="text-[var(--ink-3)]">No school yet</span>}
                      </span>
                      <StatusPill payStatus={r.payStatus} status={r.status} />
                    </div>
                    <div className="figure mt-0.5 text-xs text-[var(--ink-3)]">
                      {invoiceNumberLabel(r.number)} · {formatDate(r.date)} · {r.totals.qty} books
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <Money value={r.totals.total} />
                    {r.balance > 0.01 && r.status === "open" && (
                      <div className="text-xs text-[var(--debit)]">{formatMoney(r.balance)} owing</div>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      {rows && rows.length === 0 && (
        <div className="px-4 py-6">
          <Empty
            title={q || from || to || filter !== "all" ? "Nothing matches" : "No invoices yet"}
            hint={
              q || from || to || filter !== "all"
                ? "Try a shorter search, a wider date range, or switch the status filter back to All."
                : "Start one and it saves itself as you type."
            }
            action={
              <button className="btn btn-ink" onClick={newInvoice} disabled={creating}>
                <Plus size={18} /> New invoice
              </button>
            }
          />
        </div>
      )}
      {importing && <ImportSheet onClose={() => setImporting(false)} />}
    </main>
  );
}
