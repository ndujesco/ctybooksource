import { NextResponse } from "next/server";
import { books, ensureIndexes } from "@/lib/mongodb";
import { toBook, str, clampNum, escapeRegex } from "@/lib/serialize";
import type { BookDoc } from "@/lib/types";

export const dynamic = "force-dynamic";

// GET /api/books?q=&archived=1 — catalogue, alphabetical by short name.
export async function GET(req: Request) {
  await ensureIndexes();
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim();
  const includeArchived = searchParams.get("archived") === "1";

  const filter: Record<string, unknown> = {};
  if (!includeArchived) filter.archived = { $ne: true };
  if (q) {
    const rx = { $regex: escapeRegex(q), $options: "i" };
    filter.$or = [
      { shortName: rx },
      { fullName: rx },
      { publisher: rx },
      { category: rx },
    ];
  }

  const col = await books();
  const docs = await col
    .find(filter)
    .collation({ locale: "en", strength: 1 }) // case-insensitive sort
    .sort({ shortName: 1 })
    .limit(2000)
    .toArray();

  return NextResponse.json(docs.map(toBook));
}

// POST /api/books — add a book to the catalogue.
export async function POST(req: Request) {
  const body = await readBody(req);
  const now = new Date();
  const doc: BookDoc = {
    shortName: str(body.shortName, 200).trim(),
    fullName: str(body.fullName, 300).trim(),
    publisher: str(body.publisher, 120).trim(),
    category: str(body.category, 120).trim(),
    costPrice: clampNum(body.costPrice, 0, 100_000_000),
    sellingPrice: clampNum(body.sellingPrice, 0, 100_000_000),
    archived: false,
    createdAt: now,
    updatedAt: now,
  };
  if (!doc.shortName && !doc.fullName) {
    return NextResponse.json({ error: "A book needs a name" }, { status: 400 });
  }
  // If only one name was given, mirror it so invoices always have something
  // to print in either mode.
  if (!doc.shortName) doc.shortName = doc.fullName;
  if (!doc.fullName) doc.fullName = doc.shortName;

  const col = await books();
  const { insertedId } = await col.insertOne(doc);
  return NextResponse.json(toBook({ ...doc, _id: insertedId }), { status: 201 });
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}
