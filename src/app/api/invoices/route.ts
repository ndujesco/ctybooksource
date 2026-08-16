import { NextResponse } from "next/server";
import type { Filter } from "mongodb";
import { invoices, nextInvoiceNumber, ensureIndexes } from "@/lib/mongodb";
import {
  toInvoice,
  sanitizeLines,
  sanitizePayments,
  derived,
  promoteStatus,
  str,
  escapeRegex,
} from "@/lib/serialize";
import { isYmd, today } from "@/lib/datetime";
import type { InvoiceDoc, PayStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/invoices
 *   q=          search by school / customer name (also matches an invoice number)
 *   pay=        paid | partial | unpaid
 *   status=     draft | open | cancelled
 *   customerId= only this customer's invoices
 *   from=, to=  yyyy-mm-dd business-date range
 *   limit=      default 200
 */
export async function GET(req: Request) {
  await ensureIndexes();
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim();
  const pay = searchParams.get("pay") || "";
  const status = searchParams.get("status") || "";
  const customerId = searchParams.get("customerId") || "";
  const from = searchParams.get("from") || "";
  const to = searchParams.get("to") || "";
  const limit = Math.min(1000, Math.max(1, Number(searchParams.get("limit")) || 200));

  const filter: Filter<InvoiceDoc> = { deleted: { $ne: true } };

  if (q) {
    const rx = { $regex: escapeRegex(q), $options: "i" };
    const or: Filter<InvoiceDoc>[] = [{ customerName: rx }, { customerAddress: rx }];
    // "1042" or "INV-1042" should jump straight to that invoice.
    const asNumber = Number(q.replace(/^inv-?/i, ""));
    if (Number.isInteger(asNumber) && asNumber > 0) or.push({ number: asNumber });
    filter.$or = or;
  }
  if (pay === "paid" || pay === "partial" || pay === "unpaid") {
    filter.payStatus = pay as PayStatus;
  }
  if (status === "draft" || status === "open" || status === "cancelled") {
    filter.status = status;
  }
  if (customerId) filter.customerId = customerId;
  if (isYmd(from) || isYmd(to)) {
    const range: Record<string, string> = {};
    if (isYmd(from)) range.$gte = from;
    if (isYmd(to)) range.$lte = to;
    filter.date = range;
  }

  const col = await invoices();
  const docs = await col
    .find(filter)
    .sort({ date: -1, number: -1 })
    .limit(limit)
    .toArray();

  return NextResponse.json(docs.map(toInvoice));
}

// POST /api/invoices — start a new invoice. Created immediately so the editor
// has a real id to autosave against.
export async function POST(req: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    /* empty body is fine */
  }

  const lines = sanitizeLines(body.lines);
  const payments = sanitizePayments(body.payments);
  const discountPercent = Number(body.discountPercent) || 0;

  const now = new Date();
  const customerName = str(body.customerName, 200);
  const doc: InvoiceDoc = {
    number: await nextInvoiceNumber(),
    customerId: typeof body.customerId === "string" && body.customerId ? body.customerId : null,
    customerName,
    customerPhone: str(body.customerPhone, 80),
    customerAddress: str(body.customerAddress, 300),
    lines,
    date: isYmd(body.date) ? (body.date as string) : today(),
    discountPercent,
    payments,
    notes: str(body.notes, 2000),
    // An order that arrives complete (from the AI import, or from a customer's
    // "new invoice" button) is already a real sale — don't strand it as a draft.
    status: promoteStatus("draft", customerName, lines),
    ...derived(lines, discountPercent, payments),
    deleted: false,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  const col = await invoices();
  const { insertedId } = await col.insertOne(doc);
  return NextResponse.json(toInvoice({ ...doc, _id: insertedId }), { status: 201 });
}
