import { NextResponse } from "next/server";
import type { Document } from "mongodb";
import { books, invoices, ensureIndexes } from "@/lib/mongodb";
import { toBook } from "@/lib/serialize";
import { titleKey } from "@/lib/booknames";
import { round2, type Book } from "@/lib/types";

export const dynamic = "force-dynamic";

export type DuplicateBook = Book & {
  qty: number; // copies sold under this record
  revenue: number;
  lineCount: number; // invoice lines pointing at it
  lastSold: string | null;
};

export type DuplicateGroup = {
  key: string;
  title: string; // the clearest of the spellings — the suggested survivor's name
  suggestedKeepId: string;
  books: DuplicateBook[];
  qty: number; // copies the joined record would show
};

/**
 * GET /api/books/duplicates
 *
 * The same book, entered more than once. Grouped by what the title actually
 * names (`titleKey`), so "Fun Science Nur. 1" and "Fun Science Nursery 1" land
 * together while "Book 5" and "Book 6" never do.
 *
 * Nothing here changes anything — it only proposes. The survivor it suggests is
 * the record that knows the most: a publisher first (the hand-typed duplicates
 * are the ones missing it), then the one carrying the most sales.
 */
export async function GET() {
  await ensureIndexes();

  const [bcol, icol] = await Promise.all([books(), invoices()]);
  const docs = await bcol.find({}).limit(10_000).toArray();

  // Sales per book, so the merge can say what it is about to join.
  const sold = await icol
    .aggregate<Document>([
      { $match: { deleted: { $ne: true }, status: "open" } },
      { $unwind: "$lines" },
      { $match: { "lines.bookId": { $ne: null } } },
      {
        $group: {
          _id: "$lines.bookId",
          qty: { $sum: "$lines.qty" },
          revenue: { $sum: { $multiply: ["$lines.qty", "$lines.unitPrice"] } },
          lineCount: { $sum: 1 },
          lastSold: { $max: "$date" },
        },
      },
    ])
    .toArray();
  const stats = new Map(sold.map((r) => [String(r._id), r]));

  const groups = new Map<string, DuplicateBook[]>();
  for (const d of docs) {
    const book = toBook(d);
    const key = titleKey(book.name);
    if (!key) continue;
    const s = stats.get(book.id);
    const row: DuplicateBook = {
      ...book,
      qty: s?.qty || 0,
      revenue: round2(s?.revenue || 0),
      lineCount: s?.lineCount || 0,
      lastSold: (s?.lastSold as string) || null,
    };
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }

  const out: DuplicateGroup[] = [];
  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    const ranked = [...list].sort(score);
    out.push({
      key,
      title: ranked[0].name,
      suggestedKeepId: ranked[0].id,
      books: ranked,
      qty: list.reduce((s, b) => s + b.qty, 0),
    });
  }

  // Busiest duplicates first — those are the ones distorting the figures most.
  out.sort((a, b) => b.qty - a.qty || a.title.localeCompare(b.title));
  return NextResponse.json(out);
}

/** Best record first: knows its publisher, then carries the most sales. */
function score(a: DuplicateBook, b: DuplicateBook): number {
  const known = (x: DuplicateBook) =>
    (x.publisher ? 4 : 0) + (x.costPrice > 0 ? 2 : 0) + (x.archived ? -8 : 0);
  return known(b) - known(a) || b.qty - a.qty || b.lineCount - a.lineCount ||
    a.name.localeCompare(b.name);
}
