import { NextResponse } from "next/server";
import { ensureIndexes } from "@/lib/mongodb";
import {
  kpi,
  growth,
  series,
  products,
  slowMovers,
  customerStats,
  dormantCustomers,
  receivables,
  groupBy,
} from "@/lib/analytics";
import { periodRange, previousRange, type Period } from "@/lib/datetime";

export const dynamic = "force-dynamic";

const PERIODS: Period[] = ["today", "week", "month", "year", "all", "custom"];

/**
 * GET /api/analytics?period=month|today|week|year|all|custom&from=&to=
 *   &stale=60   days without a sale before a book counts as slow-moving
 *   &quiet=45   days without a purchase before a customer counts as dormant
 */
export async function GET(req: Request) {
  await ensureIndexes();
  const { searchParams } = new URL(req.url);

  const raw = searchParams.get("period") || "month";
  const period = (PERIODS.includes(raw as Period) ? raw : "month") as Period;
  const range = periodRange(period, {
    from: searchParams.get("from") || undefined,
    to: searchParams.get("to") || undefined,
  });
  const prev = previousRange(range);
  const stale = clamp(searchParams.get("stale"), 7, 365, 60);
  const quiet = clamp(searchParams.get("quiet"), 7, 365, 45);

  const [
    current, previous, chart, topProducts, slow,
    topCustomers, dormant, debt, byPublisher, byCategory,
  ] = await Promise.all([
    kpi(range),
    kpi(prev),
    series(range),
    products(range, 50),
    slowMovers(stale, 40),
    customerStats(range, 50),
    dormantCustomers(quiet, 30),
    receivables(),
    groupBy("publisher", range, 30),
    groupBy("category", range, 30),
  ]);

  return NextResponse.json({
    period,
    range,
    previousRange: prev,
    kpi: current,
    previous,
    growth: {
      sales: growth(current.sales, previous.sales),
      collected: growth(current.collected, previous.collected),
      profit: growth(current.profit, previous.profit),
      invoices: growth(current.invoiceCount, previous.invoiceCount),
    },
    series: chart,
    products: {
      // One ranked list, sorted client-side by qty / revenue / profit.
      top: topProducts,
      slow,
      staleDays: stale,
    },
    customers: { top: topCustomers, dormant, quietDays: quiet },
    debt,
    profit: {
      revenue: current.sales,
      cost: current.cost,
      gross: current.profit,
      margin: current.margin,
      byPublisher,
      byCategory,
    },
  });
}

// Takes the raw param, not a number: an absent param is `null`, and both
// `Number(null)` and `Number("")` are 0 — which would silently clamp to the
// minimum instead of using the default.
function clamp(raw: string | null, min: number, max: number, fallback: number): number {
  if (raw === null || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}
