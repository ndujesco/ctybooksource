import { NextResponse } from "next/server";
import { ensureIndexes } from "@/lib/mongodb";
import { grandSales } from "@/lib/analytics";
import { periodRange, type Period } from "@/lib/datetime";

export const dynamic = "force-dynamic";

const PERIODS: Period[] = ["today", "week", "month", "year", "all", "custom"];

/**
 * GET /api/analytics/grand?period=year&from=&to=&customerId=&publisher=
 *
 * Every book sold in the period with the schools that bought it. Drafts and
 * cancelled invoices are excluded, the same as everywhere else.
 */
export async function GET(req: Request) {
  await ensureIndexes();
  const { searchParams } = new URL(req.url);

  const raw = searchParams.get("period") || "year";
  const period = (PERIODS.includes(raw as Period) ? raw : "year") as Period;
  const range = periodRange(period, {
    from: searchParams.get("from") || undefined,
    to: searchParams.get("to") || undefined,
  });

  const grand = await grandSales(range, {
    customerId: searchParams.get("customerId") || undefined,
    publisher: searchParams.get("publisher") || undefined,
  });

  return NextResponse.json({ period, range, ...grand });
}
