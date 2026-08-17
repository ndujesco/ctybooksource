import type { Book } from "@/lib/types";

/* ---------------------------------------------------------------------------
   Matching a written-down title to a book on the shelf.

   A customer's list says "oxford maths bk 5" and the catalogue says "Oxford
   Mathematics for Primary Schools Book 5". Matching the two is what makes the
   AI import worth having: a matched line carries the book's id, publisher and
   **cost price**, so the invoice lands in the profit and publisher reports
   instead of sitting there as an untracked piece of free text.
   ------------------------------------------------------------------------ */

// Written forms that mean the same thing on a Nigerian schoolbook list.
const SYNONYMS: Record<string, string> = {
  bk: "book",
  bks: "book",
  books: "book",
  bok: "book",
  pry: "primary",
  prim: "primary",
  pri: "primary",
  sec: "secondary",
  maths: "mathematics",
  math: "mathematics",
  eng: "english",
  bio: "biology",
  chem: "chemistry",
  phy: "physics",
  physic: "physics",
  govt: "government",
  lit: "literature",
  agric: "agriculture",
  agricultural: "agriculture",
  econs: "economics",
  econ: "economics",
  crs: "crs",
  workbk: "workbook",
  wbk: "workbook",
  txtbk: "textbook",
  bk1: "book 1",
};

// Words that carry no distinguishing information on a book list.
const STOP = new Set(["for", "the", "of", "and", "a", "an", "schools", "school", "series"]);

function tokenize(raw: string): string[] {
  return (raw || "")
    .toLowerCase()
    // "book5" / "jss2" are written both joined and spaced — split them apart.
    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/(\d)([a-z])/g, "$1 $2")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .flatMap((t) => (SYNONYMS[t] ?? t).split(" "))
    .filter((t) => t && !STOP.has(t));
}

function numbers(tokens: string[]): string[] {
  return tokens.filter((t) => /^\d+$/.test(t));
}

/**
 * Jaccard overlap of the two token sets. Symmetric, so a short query doesn't
 * automatically score 1.0 against every longer title that contains it.
 */
function overlap(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let shared = 0;
  for (const t of setA) if (setB.has(t)) shared++;
  return shared / (setA.size + setB.size - shared);
}

export type BookMatch = { book: Book; score: number };

/**
 * Best catalogue match for a written title, or null when nothing is close
 * enough. Deliberately conservative: a wrong match silently books the wrong
 * cost price into the profit figures, which is worse than leaving the line for
 * the user to resolve.
 */
export function matchBook(written: string, catalogue: Book[]): BookMatch | null {
  const query = tokenize(written);
  if (!query.length) return null;
  const queryNumbers = numbers(query);

  let best: BookMatch | null = null;

  for (const book of catalogue) {
    for (const candidate of [book.name]) {
      const tokens = tokenize(candidate);
      if (!tokens.length) continue;

      // Level numbers are the whole difference between "Book 5" and "Book 6".
      // Never match across them, and never guess a level that wasn't written.
      const candidateNumbers = numbers(tokens);
      if (queryNumbers.join() !== candidateNumbers.join()) continue;

      const score = overlap(query, tokens);
      if (score > (best?.score ?? 0)) best = { book, score };
    }
  }

  // 0.5 keeps "oxford maths bk 5" → "Oxford Mathematics ... Book 5" while
  // rejecting a title that merely shares a publisher.
  return best && best.score >= 0.5 ? best : null;
}
