import { NextResponse } from "next/server";
import { invoices } from "@/lib/mongodb";
import { toInvoice } from "@/lib/serialize";

export const dynamic = "force-dynamic";

// GET /api/invoices/trash — deleted invoices, most recently binned first.
export async function GET() {
  const col = await invoices();
  const docs = await col
    .find({ deleted: true })
    .sort({ deletedAt: -1 })
    .limit(300)
    .toArray();
  return NextResponse.json(docs.map(toInvoice));
}

// DELETE /api/invoices/trash — empty the bin.
export async function DELETE() {
  const col = await invoices();
  const { deletedCount } = await col.deleteMany({ deleted: true });
  return NextResponse.json({ ok: true, deletedCount });
}
