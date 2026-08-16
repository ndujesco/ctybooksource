import { NextResponse } from "next/server";
import { customers, ensureIndexes } from "@/lib/mongodb";
import { toCustomer, str, escapeRegex } from "@/lib/serialize";
import type { CustomerDoc } from "@/lib/types";

export const dynamic = "force-dynamic";

// GET /api/customers?q=&archived=1
export async function GET(req: Request) {
  await ensureIndexes();
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim();
  const includeArchived = searchParams.get("archived") === "1";

  const filter: Record<string, unknown> = {};
  if (!includeArchived) filter.archived = { $ne: true };
  if (q) {
    const rx = { $regex: escapeRegex(q), $options: "i" };
    filter.$or = [{ name: rx }, { phone: rx }, { address: rx }];
  }

  const col = await customers();
  const docs = await col
    .find(filter)
    .collation({ locale: "en", strength: 1 })
    .sort({ name: 1 })
    .limit(2000)
    .toArray();

  return NextResponse.json(docs.map(toCustomer));
}

// POST /api/customers
export async function POST(req: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    /* empty body is fine */
  }

  const name = str(body.name, 200).trim();
  if (!name) {
    return NextResponse.json({ error: "A customer needs a name" }, { status: 400 });
  }

  const now = new Date();
  const doc: CustomerDoc = {
    name,
    phone: str(body.phone, 80).trim(),
    address: str(body.address, 300).trim(),
    notes: str(body.notes, 1000),
    archived: false,
    createdAt: now,
    updatedAt: now,
  };
  const col = await customers();
  const { insertedId } = await col.insertOne(doc);
  return NextResponse.json(toCustomer({ ...doc, _id: insertedId }), { status: 201 });
}
