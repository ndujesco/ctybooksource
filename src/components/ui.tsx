"use client";

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { formatMoney, formatMoneyShort, PAY_STATUS_LABEL, type PayStatus } from "@/lib/types";

/* -- Page furniture ------------------------------------------------------ */

export function PageHeader({
  title,
  subtitle,
  back,
  action,
}: {
  title: string;
  subtitle?: string;
  back?: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="no-print flex items-start gap-3 px-4 pt-5 pb-3">
      {back && (
        <Link
          href={back}
          aria-label="Back"
          className="mt-1 -ml-1 rounded-lg p-1 text-[var(--ink-2)] hover:bg-[var(--sunken)]"
        >
          <ChevronLeft size={22} />
        </Link>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="display truncate text-[1.6rem] leading-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-[var(--ink-2)]">{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}

export function Section({
  title,
  note,
  action,
  children,
}: {
  title: string;
  note?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="px-4 py-3">
      {/* Wrapping keeps a wide control (a sort switch, say) from squeezing the
          heading onto two lines. */}
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-2">
        <h2 className="eyebrow whitespace-nowrap">{title}</h2>
        {action ?? (note ? <span className="text-xs text-[var(--ink-3)]">{note}</span> : null)}
      </div>
      {children}
    </section>
  );
}

export function Empty({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="card px-5 py-8 text-center">
      <p className="display text-lg text-[var(--ink)]">{title}</p>
      {hint && <p className="mx-auto mt-1 max-w-[38ch] text-sm text-[var(--ink-2)]">{hint}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="px-4 py-10 text-center text-sm text-[var(--ink-3)]" role="status">
      {label}…
    </div>
  );
}

export function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-lg border px-3 py-2 text-sm"
      style={{
        background: "var(--debit-soft)",
        borderColor: "rgba(179,38,30,0.25)",
        color: "var(--debit)",
      }}
    >
      {children}
    </p>
  );
}

/* -- Figures ------------------------------------------------------------- */

/** A naira figure. `tone` carries the ledger meaning, not decoration. */
export function Money({
  value,
  tone = "ink",
  short = false,
  className = "",
}: {
  value: number;
  tone?: "ink" | "credit" | "debit" | "muted";
  short?: boolean;
  className?: string;
}) {
  const color = {
    ink: "var(--ink)",
    credit: "var(--credit)",
    debit: "var(--debit)",
    muted: "var(--ink-3)",
  }[tone];
  return (
    <span className={`figure ${className}`} style={{ color }}>
      {short ? formatMoneyShort(value) : formatMoney(value)}
    </span>
  );
}

/** Headline figure for a stat tile. */
export function Stat({
  label,
  value,
  sub,
  tone = "ink",
  href,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "ink" | "credit" | "debit";
  href?: string;
}) {
  const body = (
    <div className="card h-full px-3.5 py-3">
      <div className="eyebrow">{label}</div>
      <div
        className="figure mt-1.5 text-[1.35rem] leading-none"
        style={{
          color: { ink: "var(--ink)", credit: "var(--credit)", debit: "var(--debit)" }[tone],
        }}
      >
        {value}
      </div>
      {sub && <div className="mt-1.5 text-xs text-[var(--ink-2)]">{sub}</div>}
    </div>
  );
  return href ? (
    <Link href={href} className="block h-full">
      {body}
    </Link>
  ) : (
    body
  );
}

/** Period-over-period change. Null means there's no prior period to compare. */
export function Delta({ value, invert = false }: { value: number | null; invert?: boolean }) {
  if (value === null) {
    return <span className="text-xs text-[var(--ink-3)]">no prior period</span>;
  }
  const good = invert ? value <= 0 : value >= 0;
  return (
    <span
      className="figure text-xs"
      style={{ color: value === 0 ? "var(--ink-3)" : good ? "var(--credit)" : "var(--debit)" }}
    >
      {value >= 0 ? "▲" : "▼"} {Math.abs(value).toFixed(1)}%
    </span>
  );
}

/* -- Status -------------------------------------------------------------- */

export function StatusPill({
  payStatus,
  status,
}: {
  payStatus: PayStatus;
  status: "draft" | "open" | "cancelled";
}) {
  if (status === "cancelled") return <span className="pill pill-cancelled">Cancelled</span>;
  if (status === "draft") return <span className="pill pill-draft">Draft</span>;
  return <span className={`pill pill-${payStatus}`}>{PAY_STATUS_LABEL[payStatus]}</span>;
}

/** The publisher's colour, as the spine of a book on a shelf. */
export function Spine({ color, title }: { color: string; title?: string }) {
  return <span className="spine" style={{ background: color }} title={title} aria-hidden />;
}

/* -- Controls ------------------------------------------------------------ */

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="segment no-scrollbar max-w-full overflow-x-auto" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          data-on={o.value === value}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Labelled({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="eyebrow">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-[var(--ink-3)]">{hint}</span>}
    </label>
  );
}
