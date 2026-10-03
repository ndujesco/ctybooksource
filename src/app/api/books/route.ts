import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { books, ensureIndexes } from "@/lib/mongodb";
import { toBook, str, clampNum, escapeRegex } from "@/lib/serialize";
import type { BookDoc } from "@/lib/types";

export const dynamic = "force-dynamic";

// GET /api/books?q=&archived=1&ids=a,b,c — catalogue, alphabetical by short name.
export async function GET(req: Request) {
  await ensureIndexes();
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim();
  const includeArchived = searchParams.get("archived") === "1";
  // `ids` fetches an exact set — how the invoice editor learns the *current*
  // general price of each book already on the invoice, to tell an edited price
  // apart from the standing one.
  const ids = (searchParams.get("ids") || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => ObjectId.isValid(s))
    .slice(0, 500);

  if (ids.length) {
    const col = await books();
    const docs = await col.find({ _id: { $in: ids.map((s) => new ObjectId(s)) } }).toArray();
    return NextResponse.json(docs.map(toBook));
  }

  const filter: Record<string, unknown> = {};
  if (!includeArchived) filter.archived = { $ne: true };
  if (q) {
    const rx = { $regex: escapeRegex(q), $options: "i" };
    filter.$or = [{ name: rx }, { publisher: rx }, { category: rx }];
  }

  const col = await books();
  const docs = await col
    .find(filter)
    .collation({ locale: "en", strength: 1 }) // case-insensitive sort
    .sort({ name: 1 })
    .limit(2000)
    .toArray();

  return NextResponse.json(docs.map(toBook));
}

// POST /api/books — add a book to the catalogue.
export async function POST(req: Request) {
  const body = await readBody(req);
  const now = new Date();
  const doc: BookDoc = {
    name: str(body.name, 300).trim(),
    publisher: str(body.publisher, 120).trim(),
    category: str(body.category, 120).trim(),
    costPrice: clampNum(body.costPrice, 0, 100_000_000),
    sellingPrice: clampNum(body.sellingPrice, 0, 100_000_000),
    archived: false,
    createdAt: now,
    updatedAt: now,
  };
  if (!doc.name) {
    return NextResponse.json({ error: "A book needs a name" }, { status: 400 });
  }

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
