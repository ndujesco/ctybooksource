/* ---------------------------------------------------------------------------
   One book, written several ways.

   The shelf has grown by hand and by import over years, so the same title sits
   on it more than once: "Bond Non-Verbal 6-7" beside "Bond Non-Verbal. 6-7",
   "Fun Science Nur. 1" beside "Fun Science Nursery 1", "NELSON SPELLING
   WORKBOOK 1A" beside "Nelson Spelling Workbook 1A". They are the same book,
   and until they are joined, half of each one's sales are invisible.

   `titleKey()` reduces a written title to the thing it actually names, so two
   spellings of one book land on the same key. It is deliberately strict about
   the one thing that must never be smudged: **level numbers**. "Book 5" and
   "Book 6" are different books, always, and so are "1A" and "1B".
   ------------------------------------------------------------------------ */

/**
 * Multi-word forms that mean one thing, applied before tokenising so a phrase
 * can collapse to a single token. Order matters — longest first.
 */
const PHRASES: [RegExp, string][] = [
  // Schofield & Sims is written at least five ways on this shelf.
  [/\bschofield\s*(?:and|&)?\s*sims?\b/g, "schofieldsims"],
  [/\bsch\s*\.?\s*sims?\b/g, "schofieldsims"],
  [/\bs\s*[\/.]?\s*sims?\b/g, "schofieldsims"],
  [/\bnew\s+heinemann\s+math(?:ematic)?s?\b/g, "nhm"],
  [/\bjunior\s+secondary\b/g, "jss"],
  [/\bsenior\s+secondary\b/g, "sss"],
  [/\bdot\s+to\s+dot\b/g, "dottodot"],
  [/\bquantitative\s*(?:and|&)\s*verbal\b/g, "quantitativeverbal"],
  [/\bscience\s*(?:and|&)\s*tech(?:nology)?\b/g, "sciencetech"],
];

/** Single words that mean the same thing. Expanded to the fuller form. */
const WORDS: Record<string, string> = {
  bk: "book",
  bks: "book",
  books: "book",
  bok: "book",
  wbk: "workbook",
  workbk: "workbook",
  wkbk: "workbook",
  txtbk: "textbook",
  nur: "nursery",
  nurs: "nursery",
  nsy: "nursery",
  pry: "primary",
  pri: "primary",
  prim: "primary",
  sec: "secondary",
  maths: "mathematics",
  math: "mathematics",
  mths: "mathematics",
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
  colouring: "coloring",
  colour: "color",
  colours: "color",
  colors: "color",
  arith: "arithmetic",
  compre: "comprehension",
  comp: "comprehension",
  rec: "reception",
  js: "jss",
  ss: "sss",
  fnd: "foundation",
  fund: "foundation",
  // British/American spellings that show up both ways on the same shelf.
  practise: "practice",
  programme: "program",
};

/** Words that carry no identity at all — dropped before the key is built. */
const NOISE = new Set(["the", "a", "an", "of", "for", "and", "series", "new", "edition", "ed"]);

/**
 * The canonical identity of a written title. Two titles with the same key are
 * almost certainly the same book; two with different keys are not offered as
 * duplicates.
 */
export function titleKey(raw: string): string {
  return titleTokens(raw).join(" ");
}

export function titleTokens(raw: string): string[] {
  let s = (raw || "").toLowerCase();

  s = s.replace(/&/g, " and ");
  for (const [re, to] of PHRASES) s = s.replace(re, to);

  return (
    s
      // "book5" and "jss2" are written joined as often as spaced.
      .replace(/([a-z])(\d)/g, "$1 $2")
      // ...but a trailing letter on a number is a level marker ("1A", "2B")
      // and must stay welded to it, or 1A and 1B become the same book.
      .replace(/(\d)\s*([a-z])\b/g, "$1$2")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .map((t) => WORDS[t] ?? t)
      .filter((t) => t && !NOISE.has(t))
  );
}

/** Just the level markers: 5, 1a, 6, 7. The part that must never be smudged. */
export function levels(raw: string): string[] {
  return titleTokens(raw).filter((t) => /^\d/.test(t));
}

/**
 * How alike two titles are, 0–1, ignoring word order. Used to rank candidates
 * when the user is picking books to join by hand — never to join them unasked.
 */
export function titleSimilarity(a: string, b: string): number {
  // Different levels means different books, full stop.
  if (levels(a).join() !== levels(b).join()) return 0;
  const ta = new Set(titleTokens(a));
  const tb = new Set(titleTokens(b));
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / (ta.size + tb.size - shared);
}
