import { NextResponse } from "next/server";
import { ensureIndexes } from "@/lib/mongodb";
import { kpi, growth, receivables, recentInvoices, draftCount } from "@/lib/analytics";
import { periodRange, previousRange } from "@/lib/datetime";

export const dynamic = "force-dynamic";

/** Everything the home dashboard needs, in one round trip. */
export async function GET() {
  await ensureIndexes();

  const dayR = periodRange("today");
  const monthR = periodRange("month");
  const yearR = periodRange("year");

  const [day, month, year, prevMonth, debt, recent, drafts] = await Promise.all([
    kpi(dayR),
    kpi(monthR),
    kpi(yearR),
    kpi(previousRange(monthR)),
    receivables(),
    recentInvoices(8),
    draftCount(),
  ]);

  return NextResponse.json({
    today: { range: dayR, ...day },
    month: {
      range: monthR,
      ...month,
      salesGrowth: growth(month.sales, prevMonth.sales),
      profitGrowth: growth(month.profit, prevMonth.profit),
      previousSales: prevMonth.sales,
    },
    year: { range: yearR, ...year },
    debt: {
      totalOutstanding: debt.totalOutstanding,
      invoiceCount: debt.invoiceCount,
      customerCount: debt.customerCount,
      aging: debt.aging,
      topDebtors: debt.topDebtors.slice(0, 5),
    },
    recent,
    drafts,
  });
}
