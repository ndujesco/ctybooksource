"use client";

import { useEffect, useRef, useState } from "react";
import { formatMoney, formatMoneyShort } from "@/lib/types";

/** Actual rendered width, so SVG text is drawn at 1:1 instead of being scaled. */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}

/* ===========================================================================
   Sales over time — bars for what was invoiced, a line for what was collected.
   Both are naira, so they share one axis. Never two scales.
   ======================================================================== */

export type TimePoint = { key: string; label: string; sales: number; collected: number };

export function TimeChart({ points, height = 190 }: { points: TimePoint[]; height?: number }) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const pad = { top: 12, right: 8, bottom: 22, left: 44 };
  const plotW = Math.max(0, width - pad.left - pad.right);
  const plotH = height - pad.top - pad.bottom;

  const max = Math.max(1, ...points.flatMap((p) => [p.sales, p.collected]));
  const ticks = niceTicks(max, 3);
  const top = ticks[ticks.length - 1];
  const y = (v: number) => pad.top + plotH - (v / top) * plotH;

  const band = points.length ? plotW / points.length : 0;
  // 2px of surface between bars keeps adjacent fills from fusing.
  const barW = Math.max(2, Math.min(26, band - 2));
  const cx = (i: number) => pad.left + band * i + band / 2;

  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${cx(i).toFixed(1)},${y(p.collected).toFixed(1)}`)
    .join(" ");

  // Label only the ends and the middle — a label on every bar is unreadable on
  // a phone and adds nothing.
  const labelAt = new Set([0, Math.floor((points.length - 1) / 2), points.length - 1]);
  const active = hover !== null ? points[hover] : null;

  return (
    <div className="relative" ref={ref}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`Sales and collections by ${points.length} periods`}
          onPointerLeave={() => setHover(null)}
          onPointerMove={(e) => {
            const box = e.currentTarget.getBoundingClientRect();
            const i = Math.floor((e.clientX - box.left - pad.left) / (band || 1));
            setHover(i >= 0 && i < points.length ? i : null);
          }}
        >
          {/* Recessive grid */}
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={pad.left}
                x2={width - pad.right}
                y1={y(t)}
                y2={y(t)}
                stroke="var(--rule)"
                strokeWidth={1}
              />
              <text
                x={pad.left - 6}
                y={y(t) + 3.5}
                textAnchor="end"
                fontSize={10}
                fontFamily="var(--font-mono)"
                fill="var(--ink-3)"
              >
                {t === 0 ? "0" : formatMoneyShort(t)}
              </text>
            </g>
          ))}

          {points.map((p, i) => {
            const h = Math.max(p.sales > 0 ? 2 : 0, plotH - (y(p.sales) - pad.top));
            return (
              <rect
                key={p.key}
                x={cx(i) - barW / 2}
                y={y(p.sales)}
                width={barW}
                height={h}
                rx={Math.min(4, barW / 2)}
                fill="var(--spine-1)"
                opacity={hover === null || hover === i ? 1 : 0.45}
              />
            );
          })}

          {points.length > 1 && (
            <path d={linePath} fill="none" stroke="var(--credit)" strokeWidth={2} strokeLinejoin="round" />
          )}

          {hover !== null && (
            <line
              x1={cx(hover)}
              x2={cx(hover)}
              y1={pad.top}
              y2={pad.top + plotH}
              stroke="var(--ink-3)"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
          )}
          {hover !== null && (
            <circle
              cx={cx(hover)}
              cy={y(points[hover].collected)}
              r={4}
              fill="var(--credit)"
              stroke="var(--card)"
              strokeWidth={2}
            />
          )}

          {points.map((p, i) =>
            labelAt.has(i) ? (
              <text
                key={`x${p.key}`}
                x={cx(i)}
                y={height - 6}
                textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}
                fontSize={10}
                fontFamily="var(--font-mono)"
                fill="var(--ink-3)"
              >
                {p.label}
              </text>
            ) : null
          )}
        </svg>
      )}

      {active && (
        <div
          className="pointer-events-none absolute top-0 z-10 rounded-lg border border-[var(--rule)] bg-[var(--card)] px-2.5 py-1.5 text-xs shadow-lg"
          style={{
            left: Math.min(Math.max(0, cx(hover!) - 60), Math.max(0, width - 132)),
            minWidth: 120,
          }}
        >
          <div className="font-semibold">{active.label}</div>
          <div className="mt-1 flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-[var(--ink-2)]">
              <i className="h-2 w-2 rounded-sm" style={{ background: "var(--spine-1)" }} />
              Invoiced
            </span>
            <span className="figure">{formatMoney(active.sales)}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-[var(--ink-2)]">
              <i className="h-2 w-2 rounded-sm" style={{ background: "var(--credit)" }} />
              Collected
            </span>
            <span className="figure">{formatMoney(active.collected)}</span>
          </div>
        </div>
      )}

      <Legend
        items={[
          { color: "var(--spine-1)", label: "Invoiced" },
          { color: "var(--credit)", label: "Collected" },
        ]}
      />
    </div>
  );
}

export function Legend({ items }: { items: { color: string; label: string }[] }) {
  return (
    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-1.5 text-xs text-[var(--ink-2)]">
          <span className="h-2 w-2 rounded-sm" style={{ background: it.color }} />
          {it.label}
        </li>
      ))}
    </ul>
  );
}

/* ===========================================================================
   Ranked bars — plain HTML, because a ranking is a list with a length encoded.
   Values are direct-labelled, so no tooltip is needed to read it.
   ======================================================================== */

export type RankRow = {
  key: string;
  label: string;
  sub?: string;
  value: number;
  color?: string;
  href?: string;
  display?: string;
};

export function RankBars({
  rows,
  emptyLabel = "Nothing to rank yet.",
}: {
  rows: RankRow[];
  emptyLabel?: string;
}) {
  if (rows.length === 0) {
    return <p className="px-1 py-3 text-sm text-[var(--ink-3)]">{emptyLabel}</p>;
  }
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));

  return (
    <ol className="space-y-2.5">
      {rows.map((r, i) => (
        <li key={r.key}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="figure text-xs text-[var(--ink-3)]">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="truncate text-sm font-medium">{r.label}</span>
            </span>
            <span className="figure shrink-0 text-sm">{r.display ?? formatMoney(r.value)}</span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--sunken)]">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.max(1.5, (Math.abs(r.value) / max) * 100)}%`,
                  background: r.color || "var(--spine-1)",
                }}
              />
            </div>
            {r.sub && <span className="shrink-0 text-xs text-[var(--ink-3)]">{r.sub}</span>}
          </div>
        </li>
      ))}
    </ol>
  );
}

/* ===========================================================================
   Debt ageing — ordered buckets, one hue darkening with age.
   ======================================================================== */

export function AgingBar({
  buckets,
  colors,
}: {
  buckets: { label: string; amount: number; count: number }[];
  colors: readonly string[];
}) {
  const total = buckets.reduce((s, b) => s + b.amount, 0);
  if (total <= 0) {
    return <p className="text-sm text-[var(--ink-3)]">Nothing outstanding. Every invoice is settled.</p>;
  }
  return (
    <div>
      {/* 2px surface gaps keep the segments from reading as one block. */}
      <div className="flex h-3 gap-[2px] overflow-hidden rounded-full">
        {buckets.map((b, i) =>
          b.amount > 0 ? (
            <div
              key={b.label}
              className="h-full first:rounded-l-full last:rounded-r-full"
              style={{ width: `${(b.amount / total) * 100}%`, background: colors[i] }}
            />
          ) : null
        )}
      </div>
      <ul className="ruled mt-3">
        {buckets.map((b, i) => (
          <li key={b.label} className="flex items-center justify-between gap-3 py-2">
            <span className="flex items-center gap-2 text-sm">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: colors[i] }} />
              {b.label}
              <span className="text-xs text-[var(--ink-3)]">
                {b.count} {b.count === 1 ? "invoice" : "invoices"}
              </span>
            </span>
            <span className="figure text-sm" style={{ color: "var(--debit)" }}>
              {formatMoney(b.amount)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Round the axis to 1/2/2.5/5 × 10ⁿ steps so tick labels are readable numbers.
 * The top tick is rounded *up* past the largest value — stopping at the last
 * step below it would draw bars taller than the plot and clip them.
 */
function niceTicks(max: number, count: number): number[] {
  const raw = max / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag * 10;
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + step * 0.001; v += step) ticks.push(Math.round(v));
  if (ticks.length < 2) ticks.push(Math.round(step));
  return ticks;
}
