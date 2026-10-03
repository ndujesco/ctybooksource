import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { bookPrices, books, ensureIndexes } from "@/lib/mongodb";
import { clampNum, toBook } from "@/lib/serialize";
import type { Book } from "@/lib/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** A school's own price for a book, alongside the general one it departs from. */
export type SchoolPrice = {
  bookId: string;
  sellingPrice: number;
  updatedAt: string;
  book: Book | null;
};

/**
 * GET /api/customers/:id/prices
 *
 * Every price this school has of its own. The invoice editor loads this once
 * when a school is chosen, so putting a book on the invoice costs no round trip.
 */
export async function GET(_req: Request, { params }: Ctx) {
  await ensureIndexes();
  const { id } = await params;
  if (!id) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const col = await bookPrices();
  const rows = await col.find({ customerId: id }).limit(5000).toArray();
  if (!rows.length) return NextResponse.json([]);

  // Hydrate with the book so the school's price list is readable on its own.
  const ids = rows.map((r) => r.bookId).filter((b) => ObjectId.isValid(b));
  const bcol = await books();
  const docs = await bcol.find({ _id: { $in: ids.map((b) => new ObjectId(b)) } }).toArray();
  const byId = new Map(docs.map((d) => [String(d._id), toBook(d)]));

  const out: SchoolPrice[] = rows.map((r) => ({
    bookId: r.bookId,
    sellingPrice: Number(r.sellingPrice) || 0,
    updatedAt: (r.updatedAt instanceof Date ? r.updatedAt : new Date()).toISOString(),
    book: byId.get(r.bookId) ?? null,
  }));
  out.sort((a, b) => (a.book?.name || "").localeCompare(b.book?.name || ""));
  return NextResponse.json(out);
}

/**
 * PUT /api/customers/:id/prices  { bookId, sellingPrice }
 *
 * Set (or change) what this school pays for one book. Upserted against the
 * unique (customerId, bookId) index, so a double tap can't make two rows.
 * Never touches the book's general price — that is the whole point of this.
 */
export async function PUT(req: Request, { params }: Ctx) {
  await ensureIndexes();
  const { id } = await params;
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "bad body" }, { status: 400 });
  }

  const bookId = typeof body.bookId === "string" ? body.bookId : "";
  if (!id || !bookId) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const sellingPrice = clampNum(body.sellingPrice, 0, 100_000_000);

  const now = new Date();
  const col = await bookPrices();
  await col.updateOne(
    { customerId: id, bookId },
    { $set: { sellingPrice, updatedAt: now }, $setOnInsert: { customerId: id, bookId, createdAt: now } },
    { upsert: true }
  );
  return NextResponse.json({ bookId, sellingPrice });
}

/**
 * DELETE /api/customers/:id/prices?bookId=…
 * Drop the special price; the school falls back to the general one.
 */
export async function DELETE(req: Request, { params }: Ctx) {
  const { id } = await params;
  const bookId = new URL(req.url).searchParams.get("bookId") || "";
  if (!id || !bookId) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const col = await bookPrices();
  await col.deleteOne({ customerId: id, bookId });
  return NextResponse.json({ ok: true });
}
