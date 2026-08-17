import { NextResponse } from "next/server";
import { ObjectId, type Document } from "mongodb";
import { customers, invoices } from "@/lib/mongodb";
import { toCustomer, toInvoice } from "@/lib/serialize";
import { round2 } from "@/lib/types";
import { daysAgo } from "@/lib/datetime";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/customers/:id/profile — everything the customer page shows:
 * lifetime overview, full purchase history, what they still owe, and which
 * books they actually buy.
 */
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }

  const ccol = await customers();
  const customer = await ccol.findOne({ _id: new ObjectId(id) });
  if (!customer) return NextResponse.json({ error: "not found" }, { status: 404 });

  const icol = await invoices();
  const docs = await icol
    .find({ customerId: id, deleted: { $ne: true } })
    .sort({ date: -1, number: -1 })
    .limit(1000)
    .toArray();

  const history = docs.map(toInvoice);
  const sales = history.filter((i) => i.status === "open");

  const revenue = round2(sales.reduce((s, i) => s + i.totals.total, 0));
  const cost = round2(sales.reduce((s, i) => s + i.totals.cost, 0));
  const paid = round2(sales.reduce((s, i) => s + i.amountPaid, 0));
  const dates = sales.map((i) => i.date).sort();
  const lastPurchase = dates.length ? dates[dates.length - 1] : null;

  const favourites = await icol
    .aggregate<Document>([
      { $match: { customerId: id, deleted: { $ne: true }, status: "open" } },
      { $unwind: "$lines" },
      { $match: { "lines.qty": { $gt: 0 } } },
      {
        $group: {
          _id: { $ifNull: ["$lines.bookId", { $concat: ["~", "$lines.name"] }] },
          name: { $last: "$lines.name" },
          publisher: { $last: "$lines.publisher" },
          qty: { $sum: "$lines.qty" },
          revenue: { $sum: { $multiply: ["$lines.qty", "$lines.unitPrice"] } },
        },
      },
      { $sort: { qty: -1 } },
      { $limit: 15 },
    ])
    .toArray();

  return NextResponse.json({
    customer: toCustomer(customer),
    overview: {
      revenue,
      cost,
      profit: round2(revenue - cost),
      orders: sales.length,
      qty: sales.reduce((s, i) => s + i.totals.qty, 0),
      paid,
      outstanding: round2(revenue - paid),
      avgOrder: sales.length ? round2(revenue / sales.length) : 0,
      firstPurchase: dates.length ? dates[0] : null,
      lastPurchase,
      daysSincePurchase: lastPurchase ? daysAgo(lastPurchase) : null,
    },
    history,
    debts: sales
      .filter((i) => i.balance > 0.01)
      .map((i) => ({
        invoiceId: i.id,
        number: i.number,
        date: i.date,
        total: i.totals.total,
        paid: i.amountPaid,
        balance: i.balance,
        ageDays: daysAgo(i.date),
      }))
      .sort((a, b) => b.ageDays - a.ageDays),
    favourites: favourites.map((f) => ({
      name: f.name || "Unnamed book",
      publisher: f.publisher || "",
      qty: f.qty || 0,
      revenue: round2(f.revenue || 0),
    })),
    payments: sales
      .flatMap((i) =>
        i.payments.map((p) => ({
          ...p,
          invoiceId: i.id,
          invoiceNumber: i.number,
        }))
      )
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .slice(0, 50),
  });
}
