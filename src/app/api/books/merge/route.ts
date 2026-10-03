import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { bookPrices, books, invoices } from "@/lib/mongodb";
import { toBook } from "@/lib/serialize";

export const dynamic = "force-dynamic";

export type MergeResult = {
  kept: ReturnType<typeof toBook>;
  removed: number;
  invoicesTouched: number;
  linesRepointed: number;
  qtyMoved: number;
  pricesMoved: number;
  filledIn: string[]; // fields the survivor learned from the records it absorbed
};

/**
 * POST /api/books/merge  { keepId, mergeIds: [] }
 *
 * Join duplicate records into one. **The sales move first**: every invoice line
 * pointing at a duplicate is repointed to the survivor and relabelled with the
 * survivor's name and publisher, so the copies sold under the old spelling are
 * counted under the one that stays. Only then is the duplicate record removed.
 *
 * Deliberately untouched on those lines: `unitPrice` and `costPrice`. They are
 * the prices the sale actually happened at, and rewriting them would falsify
 * the profit on invoices that were settled months ago.
 */
export async function POST(req: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "bad body" }, { status: 400 });
  }

  const keepId = typeof body.keepId === "string" ? body.keepId : "";
  const mergeIds = Array.isArray(body.mergeIds)
    ? [...new Set(body.mergeIds.filter((v): v is string => typeof v === "string" && v !== keepId))]
    : [];

  if (!ObjectId.isValid(keepId)) {
    return NextResponse.json({ error: "Pick the book to keep." }, { status: 400 });
  }
  if (!mergeIds.length || mergeIds.some((id) => !ObjectId.isValid(id))) {
    return NextResponse.json({ error: "Pick at least one book to join into it." }, { status: 400 });
  }
  if (mergeIds.length > 50) {
    return NextResponse.json({ error: "Too many books in one merge." }, { status: 400 });
  }

  const bcol = await books();
  const keep = await bcol.findOne({ _id: new ObjectId(keepId) });
  if (!keep) return NextResponse.json({ error: "That book is no longer here." }, { status: 404 });

  const losers = await bcol
    .find({ _id: { $in: mergeIds.map((id) => new ObjectId(id)) } })
    .toArray();
  if (!losers.length) {
    return NextResponse.json({ error: "Those books are no longer here." }, { status: 404 });
  }
  const loserIds = losers.map((d) => String(d._id));

  /* 1. Carry the sales across, before anything is deleted. ---------------- */

  const icol = await invoices();
  const affected = await icol
    .find({ "lines.bookId": { $in: loserIds } }, { projection: { lines: 1 } })
    .toArray();

  let linesRepointed = 0;
  let qtyMoved = 0;
  for (const inv of affected) {
    for (const l of inv.lines || []) {
      if (l.bookId && loserIds.includes(l.bookId)) {
        linesRepointed++;
        qtyMoved += Number(l.qty) || 0;
      }
    }
  }

  const { modifiedCount } = await icol.updateMany(
    { "lines.bookId": { $in: loserIds } },
    {
      $set: {
        "lines.$[dupe].bookId": keepId,
        "lines.$[dupe].name": keep.name,
        "lines.$[dupe].publisher": keep.publisher || "",
        "lines.$[dupe].category": keep.category || "",
        updatedAt: new Date(),
      },
    },
    { arrayFilters: [{ "dupe.bookId": { $in: loserIds } }] }
  );

  /* 2. Carry school prices across, where the survivor hasn't got one. ----- */

  const pcol = await bookPrices();
  const [dupePrices, keptPrices] = await Promise.all([
    pcol.find({ bookId: { $in: loserIds } }).toArray(),
    pcol.find({ bookId: keepId }).toArray(),
  ]);
  const alreadyPriced = new Set(keptPrices.map((p) => p.customerId));

  let pricesMoved = 0;
  for (const p of dupePrices) {
    // The survivor's own price for that school wins; a second one would only
    // be a different answer to the same question.
    if (!alreadyPriced.has(p.customerId)) {
      await pcol.updateOne(
        { customerId: p.customerId, bookId: keepId },
        {
          $set: { sellingPrice: p.sellingPrice, updatedAt: new Date() },
          $setOnInsert: { customerId: p.customerId, bookId: keepId, createdAt: new Date() },
        },
        { upsert: true }
      );
      alreadyPriced.add(p.customerId);
      pricesMoved++;
    }
  }
  await pcol.deleteMany({ bookId: { $in: loserIds } });

  /* 3. Let the survivor keep anything only the duplicates knew. ----------- */

  const fill: Record<string, unknown> = {};
  const filledIn: string[] = [];
  if (!keep.publisher) {
    const from = losers.find((d) => d.publisher);
    if (from) {
      fill.publisher = from.publisher;
      filledIn.push("publisher");
    }
  }
  if (!keep.category) {
    const from = losers.find((d) => d.category);
    if (from) {
      fill.category = from.category;
      filledIn.push("subject");
    }
  }
  if (!(keep.costPrice > 0)) {
    const from = losers.find((d) => (d.costPrice || 0) > 0);
    if (from) {
      fill.costPrice = from.costPrice;
      filledIn.push("cost price");
    }
  }
  if (!(keep.sellingPrice > 0)) {
    const from = losers.find((d) => (d.sellingPrice || 0) > 0);
    if (from) {
      fill.sellingPrice = from.sellingPrice;
      filledIn.push("selling price");
    }
  }

  /* 4. Only now is the duplicate record safe to remove. ------------------- */

  await bcol.deleteMany({ _id: { $in: losers.map((d) => d._id!) } });

  const updated = await bcol.findOneAndUpdate(
    { _id: keep._id! },
    { $set: { ...fill, archived: false, updatedAt: new Date() } },
    { returnDocument: "after" }
  );

  const result: MergeResult = {
    kept: toBook(updated ?? keep),
    removed: losers.length,
    invoicesTouched: modifiedCount,
    linesRepointed,
    qtyMoved,
    pricesMoved,
    filledIn,
  };
  return NextResponse.json(result);
}
