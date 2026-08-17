import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { books, invoices } from "@/lib/mongodb";
import { toBook, str, clampNum } from "@/lib/serialize";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function oid(id: string): ObjectId | null {
  return ObjectId.isValid(id) ? new ObjectId(id) : null;
}

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const _id = oid(id);
  if (!_id) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const col = await books();
  const doc = await col.findOne({ _id });
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(toBook(doc));
}

// PATCH /api/books/:id
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

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof body.name === "string") set.name = str(body.name, 300).trim();
  if (typeof body.publisher === "string") set.publisher = str(body.publisher, 120).trim();
  if (typeof body.category === "string") set.category = str(body.category, 120).trim();
  if (body.costPrice !== undefined) set.costPrice = clampNum(body.costPrice, 0, 100_000_000);
  if (body.sellingPrice !== undefined) {
    set.sellingPrice = clampNum(body.sellingPrice, 0, 100_000_000);
  }
  if (typeof body.archived === "boolean") set.archived = body.archived;

  const col = await books();
  const doc = await col.findOneAndUpdate({ _id }, { $set: set }, { returnDocument: "after" });
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(toBook(doc));
}

// DELETE /api/books/:id              -> archive (hidden from pickers, history intact)
// DELETE /api/books/:id?permanent=1  -> remove the record entirely
//
// Past invoices snapshot the book's names and prices, so neither one rewrites
// history. Permanent delete is refused while the book still appears on an
// invoice, so product analytics keeps a record to point at.
export async function DELETE(req: Request, { params }: Ctx) {
  const { id } = await params;
  const _id = oid(id);
  if (!_id) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const col = await books();
  const permanent = new URL(req.url).searchParams.get("permanent") === "1";

  if (permanent) {
    const inv = await invoices();
    const used = await inv.countDocuments({ "lines.bookId": id }, { limit: 1 });
    if (used > 0) {
      return NextResponse.json(
        { error: "This book appears on an invoice. Archive it instead." },
        { status: 409 }
      );
    }
    await col.deleteOne({ _id });
  } else {
    await col.updateOne({ _id }, { $set: { archived: true, updatedAt: new Date() } });
  }
  return NextResponse.json({ ok: true });
}
