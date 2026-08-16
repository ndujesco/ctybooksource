import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { invoices } from "@/lib/mongodb";
import {
  toInvoice,
  sanitizeLines,
  sanitizePayments,
  derived,
  promoteStatus,
  str,
} from "@/lib/serialize";
import { isYmd } from "@/lib/datetime";
import { clampPercent, type InvoiceDoc } from "@/lib/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function oid(id: string): ObjectId | null {
  return ObjectId.isValid(id) ? new ObjectId(id) : null;
}

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const _id = oid(id);
  if (!_id) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const col = await invoices();
  const doc = await col.findOne({ _id });
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(toInvoice(doc));
}

/**
 * PATCH /api/invoices/:id — the one write path for the editor's autosave.
 *
 * Money is never taken from the client: whatever lines/discount/payments come
 * in, the totals, balance and pay status are recomputed here.
 */
export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const _id = oid(id);
  if (!_id) return NextResponse.json({ error: "bad id" }, { status: 400 });

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "bad body" }, { status: 400 });
  }

  const col = await invoices();
  const current = await col.findOne({ _id });
  if (!current) return NextResponse.json({ error: "not found" }, { status: 404 });

  const set: Record<string, unknown> = { updatedAt: new Date() };

  if (typeof body.customerId === "string" || body.customerId === null) {
    set.customerId = (body.customerId as string) || null;
  }
  if (typeof body.customerName === "string") set.customerName = str(body.customerName, 200);
  if (typeof body.customerPhone === "string") set.customerPhone = str(body.customerPhone, 80);
  if (typeof body.customerAddress === "string") {
    set.customerAddress = str(body.customerAddress, 300);
  }
  if (isYmd(body.date)) set.date = body.date;
  if (typeof body.notes === "string") set.notes = str(body.notes, 2000);

  const lines = body.lines !== undefined ? sanitizeLines(body.lines) : current.lines || [];
  const payments =
    body.payments !== undefined ? sanitizePayments(body.payments) : current.payments || [];
  const discountPercent =
    body.discountPercent !== undefined
      ? clampPercent(Number(body.discountPercent) || 0)
      : current.discountPercent || 0;

  if (body.lines !== undefined) set.lines = lines;
  if (body.payments !== undefined) set.payments = payments;
  if (body.discountPercent !== undefined) set.discountPercent = discountPercent;

  Object.assign(set, derived(lines, discountPercent, payments));

  // Cancelling / un-cancelling is the only status the client sets directly.
  if (body.status === "cancelled" || body.status === "open" || body.status === "draft") {
    set.status = body.status;
  }
  if (typeof body.deleted === "boolean") {
    set.deleted = body.deleted;
    set.deletedAt = body.deleted ? new Date() : null;
  }

  set.status = promoteStatus(
    (set.status ?? current.status) as InvoiceDoc["status"],
    (set.customerName ?? current.customerName ?? "") as string,
    lines
  );

  const doc = await col.findOneAndUpdate({ _id }, { $set: set }, { returnDocument: "after" });
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(toInvoice(doc));
}

// Mirrors PATCH so an unload-time beacon (POST-only) can still save.
export async function POST(req: Request, ctx: Ctx) {
  return PATCH(req, ctx);
}

// DELETE /api/invoices/:id             -> trash (recoverable)
// DELETE /api/invoices/:id?permanent=1 -> gone for good
export async function DELETE(req: Request, { params }: Ctx) {
  const { id } = await params;
  const _id = oid(id);
  if (!_id) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const col = await invoices();
  const permanent = new URL(req.url).searchParams.get("permanent") === "1";
  if (permanent) {
    await col.deleteOne({ _id });
  } else {
    await col.updateOne(
      { _id },
      { $set: { deleted: true, deletedAt: new Date(), updatedAt: new Date() } }
    );
  }
  return NextResponse.json({ ok: true });
}
