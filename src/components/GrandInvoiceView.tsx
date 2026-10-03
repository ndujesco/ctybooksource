"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Printer, Search } from "lucide-react";
import { getGrand, type Grand, type GrandRow } from "@/lib/client";
import { formatMoney } from "@/lib/types";
import { formatRange, type Period } from "@/lib/datetime";
import { spineColor } from "@/lib/spine";
import { Empty, ErrorNote, Loading, PageHeader, Segmented, Spine } from "@/components/ui";
import { useBusiness } from "@/lib/use-settings";

/* ---------------------------------------------------------------------------
   The grand invoice.

   Not one school's invoice — every copy of every book that left the building in
   a period, on one sheet. "Bond Maths 5-6: 312 copies" with the schools that
   took them underneath. It is the sheet you reorder from, and the sheet you
   check a term's trade against.

   Same rule as every other figure in the app: only `open` invoices count.
   ------------------------------------------------------------------------ */

type View = "book" | "school";
type Sort = "qty" | "revenue" | "name" | "publisher";

const PERIODS: { value: Period; label: string }[] = [
  { value: "month", label: "Month" },
  { value: "year", label: "Year" },
  { value: "all", label: "All time" },
  { value: "custom", label: "Custom" },
];

const VIEWS: { value: View; label: string }[] = [
  { value: "book", label: "By book" },
  { value: "school", label: "By school" },
];

const SORTS: { value: Sort; label: string }[] = [
  { value: "qty", label: "Copies" },
  { value: "revenue", label: "Value" },
  { value: "name", label: "A–Z" },
  { value: "publisher", label: "Publisher" },
];

export default function GrandInvoiceView() {
  const [period, setPeriod] = useState<Period>("year");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [view, setView] = useState<View>("book");
  const [sort, setSort] = useState<Sort>("qty");
  const [school, setSchool] = useState(""); // customerId, "" = every school
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());

  const [data, setData] = useState<Grand | null>(null);
  // The school list is built from the *unfiltered* sheet, so narrowing to one
  // school doesn't empty the control you'd use to get back out of it again.
  const [allSchools, setAllSchools] = useState<Grand["schools"]>([]);
  const [error, setError] = useState("");
  const business = useBusiness();

  const load = useCallback(() => {
    const params: Record<string, string> = { period };
    if (period === "custom") {
      if (from) params.from = from;
      if (to) params.to = to;
    }
    if (school) params.customerId = school;
    getGrand(params)
      .then((d) => {
        setError("");
        setData(d);
        if (!school) setAllSchools(d.schools);
      })
      .catch((e: Error) => setError(e.message));
  }, [period, from, to, school]);

  useEffect(load, [load]);

  const rows = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    const filtered = needle
      ? data.rows.filter(
          (r) =>
            r.name.toLowerCase().includes(needle) ||
            r.publisher.toLowerCase().includes(needle)
        )
      : data.rows;
    return [...filtered].sort(comparator(sort));
  }, [data, q, sort]);

  const shown = useMemo(
    () => ({
      qty: rows.reduce((s, r) => s + r.qty, 0),
      revenue: rows.reduce((s, r) => s + r.revenue, 0),
    }),
    [rows]
  );

  const schoolName = allSchools.find((s) => s.customerId === school)?.name ?? "";

  function toggle(key: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <main>
      <PageHeader
        title="Grand invoice"
        subtitle="Every book sold in the period, and the schools that took them."
        back="/reports"
        action={
          <button
            className="btn btn-quiet no-print px-3"
            onClick={() => window.print()}
            aria-label="Print this sheet"
          >
            <Printer size={17} />
          </button>
        }
      />

      <div className="no-print sticky top-0 z-30 space-y-2 border-b border-[var(--rule)] bg-[var(--paper)]/95 px-4 pb-3 backdrop-blur">
        <Segmented label="Period" value={period} options={PERIODS} onChange={setPeriod} />
        {period === "custom" && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              className="field"
              value={from}
              max={to || undefined}
              onChange={(e) => setFrom(e.target.value)}
              aria-label="From date"
            />
            <span className="text-sm text-[var(--ink-3)]">to</span>
            <input
              type="date"
              className="field"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
              aria-label="To date"
            />
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Segmented label="Grouping" value={view} options={VIEWS} onChange={setView} />
          {view === "book" && (
            <Segmented label="Sort by" value={sort} options={SORTS} onChange={setSort} />
          )}
        </div>
        <div className="flex gap-2">
          <select
            className="field min-w-0 flex-1"
            value={school}
            onChange={(e) => setSchool(e.target.value)}
            aria-label="Filter by school"
          >
            <option value="">Every school</option>
            {allSchools
              .filter((s) => s.customerId)
              .map((s) => (
                <option key={s.customerId} value={s.customerId!}>
                  {s.name} — {s.qty} copies
                </option>
              ))}
          </select>
          {view === "book" && (
            <div className="relative flex-1">
              <Search
                size={16}
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[var(--ink-3)]"
              />
              <input
                className="field pl-9"
                placeholder="Find a title"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                aria-label="Find a title"
              />
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="px-4 pt-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
      {!data && !error && <Loading label="Adding up the term" />}

      {data && (
        <>
          {/* The masthead for the printed sheet. */}
          <div className="px-4 pt-4">
            <div className="hidden print:block">
              <p className="display text-xl">{business.name || "Grand invoice"}</p>
            </div>
            <div className="card px-4 py-3">
              <p className="eyebrow">
                {schoolName || "All schools"} · {formatRange(data.range)}
              </p>
              <div className="mt-2 flex flex-wrap items-baseline gap-x-5 gap-y-1">
                <span className="figure text-[1.5rem] leading-none">{shown.qty}</span>
                <span className="text-sm text-[var(--ink-2)]">
                  copies across {rows.length} {rows.length === 1 ? "title" : "titles"}
                  {!school && data.totals.schools > 0
                    ? ` and ${data.totals.schools} ${
                        data.totals.schools === 1 ? "school" : "schools"
                      }`
                    : ""}
                </span>
                <span className="figure ml-auto text-[1.25rem] leading-none">
                  {formatMoney(shown.revenue)}
                </span>
              </div>
            </div>
          </div>

          {view === "book" ? (
            rows.length === 0 ? (
              <div className="px-4 py-6">
                <Empty
                  title={q ? "No title matches" : "Nothing sold in this period"}
                  hint={
                    q
                      ? "Try part of the title, or the publisher."
                      : "Widen the period, or check that the invoices are open rather than drafts."
                  }
                />
              </div>
            ) : (
              <ul className="ruled mt-3">
                {rows.map((r, i) => {
                  const key = r.bookId ?? `~${r.name}`;
                  const isOpen = open.has(key);
                  return (
                    <li key={key} className="px-4 py-2.5">
                      <div className="flex items-stretch gap-3">
                        <span className="figure w-6 shrink-0 self-center text-right text-xs text-[var(--ink-3)]">
                          {i + 1}
                        </span>
                        <Spine color={spineColor(r.publisher)} title={r.publisher} />
                        <button
                          type="button"
                          className="min-w-0 flex-1 text-left"
                          onClick={() => toggle(key)}
                          aria-expanded={isOpen}
                        >
                          <span className="block truncate font-medium">{r.name}</span>
                          <span className="block truncate text-xs text-[var(--ink-2)]">
                            {r.publisher || "No publisher recorded"} · {r.schoolCount}{" "}
                            {r.schoolCount === 1 ? "school" : "schools"}
                          </span>
                        </button>
                        <span className="shrink-0 self-center text-right">
                          <span className="figure block text-base leading-tight">{r.qty}</span>
                          <span className="figure block text-xs text-[var(--ink-3)]">
                            {formatMoney(r.revenue)}
                          </span>
                        </span>
                        <button
                          type="button"
                          className="no-print shrink-0 self-center text-[var(--ink-3)]"
                          onClick={() => toggle(key)}
                          aria-label={isOpen ? "Hide schools" : "Show schools"}
                        >
                          {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        </button>
                      </div>

                      {isOpen && (
                        <ul className="mt-1.5 ml-9 space-y-0.5 border-l border-[var(--rule)] pl-3">
                          {r.schools.map((s) => (
                            <li
                              key={`${key}-${s.customerId ?? s.name}`}
                              className="flex items-baseline justify-between gap-3 text-sm"
                            >
                              {s.customerId ? (
                                <Link
                                  href={`/customers/${s.customerId}`}
                                  className="min-w-0 flex-1 truncate text-[var(--ink-2)] underline-offset-2 hover:underline"
                                >
                                  {s.name}
                                </Link>
                              ) : (
                                <span className="min-w-0 flex-1 truncate text-[var(--ink-2)]">
                                  {s.name}
                                </span>
                              )}
                              <span className="figure shrink-0">{s.qty}</span>
                              <span className="figure w-24 shrink-0 text-right text-xs text-[var(--ink-3)]">
                                {formatMoney(s.revenue)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            )
          ) : (
            <SchoolView data={data} onPick={setSchool} />
          )}

          <p className="no-print px-4 py-6 text-xs text-[var(--ink-3)]">
            Drafts and cancelled invoices are left out, the same as every other figure in the app. A
            whole-invoice discount is spread across its lines, so these amounts add up to the
            invoices they came from.
          </p>
        </>
      )}
    </main>
  );
}

/* -- The same trade, read down the other axis ----------------------------- */

function SchoolView({ data, onPick }: { data: Grand; onPick: (id: string) => void }) {
  if (!data.schools.length) {
    return (
      <div className="px-4 py-6">
        <Empty title="Nothing sold in this period" />
      </div>
    );
  }
  return (
    <ul className="ruled mt-3">
      {data.schools.map((s, i) => (
        <li key={s.customerId ?? s.name} className="flex items-center gap-3 px-4 py-3">
          <span className="figure w-6 shrink-0 text-right text-xs text-[var(--ink-3)]">
            {i + 1}
          </span>
          <div className="min-w-0 flex-1">
            <span className="block truncate font-medium">{s.name}</span>
            <span className="block text-xs text-[var(--ink-2)]">
              {s.titles} {s.titles === 1 ? "title" : "titles"} · {s.orders}{" "}
              {s.orders === 1 ? "invoice" : "invoices"}
            </span>
          </div>
          <span className="shrink-0 text-right">
            <span className="figure block text-base leading-tight">{s.qty}</span>
            <span className="figure block text-xs text-[var(--ink-3)]">
              {formatMoney(s.revenue)}
            </span>
          </span>
          {s.customerId && (
            <button
              type="button"
              className="no-print shrink-0 text-xs font-semibold text-[var(--gold)] underline underline-offset-2"
              onClick={() => onPick(s.customerId!)}
            >
              only this
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function comparator(sort: Sort): (a: GrandRow, b: GrandRow) => number {
  switch (sort) {
    case "revenue":
      return (a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name);
    case "name":
      return (a, b) => a.name.localeCompare(b.name);
    case "publisher":
      return (a, b) =>
        (a.publisher || "zzz").localeCompare(b.publisher || "zzz") ||
        b.qty - a.qty ||
        a.name.localeCompare(b.name);
    default:
      return (a, b) => b.qty - a.qty || a.name.localeCompare(b.name);
  }
}