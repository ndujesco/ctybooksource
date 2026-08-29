import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { books as booksCollection } from "@/lib/mongodb";
import { toBook } from "@/lib/serialize";
import { matchBook } from "@/lib/match";
import { readSources, SourceError, type Source } from "@/lib/aiSource";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const MODEL = "claude-opus-5";
const MAX_BYTES = 30 * 1024 * 1024; // the Anthropic request limit is ~32MB across all files
const MIN_PRICE = 150; // no school book costs less than ₦150 — a smaller number is misread

const SYSTEM = `You turn a shopkeeper's description of books into catalogue entries for a Nigerian schoolbook wholesaler's price list. This is the SHELF, not an order — there is no customer and no quantity, only book titles and the prices the shop deals in.

The shopkeeper writes tersely and expects you to read Nigerian schoolbook shorthand. Example inputs and how to read them:
- "Bond from 5-6 to 9-10 1300 naira each" → five books, "Bond 5-6" through "Bond 9-10", each with sellingPrice 1300.
- "New General Mathematics book 1 to 3 by Longman, we buy at 900 sell 1200" → three books, publisher Longman, costPrice 900, sellingPrice 1200 on each.
- "Macmillan Basic Science JSS1-3 cost price 850" → three books, publisher Macmillan, costPrice 850, sellingPrice null.
- A photographed or pasted price list, one book per line, each with a single price — that price is the sellingPrice unless the list is clearly a cost/wholesale list (says "cost", "wholesale", "buying price", or is from a publisher/distributor rather than the shop's own price tag).

For each book:
- "name": the book title, written cleanly and professionally.
  - Use proper Title Case even if the source is lowercase, abbreviated or messy.
  - Normalise abbreviations CONSISTENTLY across all items. If some items in a series spell a word out and others abbreviate it, apply the same form to every item in that series. In particular treat "bk" as "Book". Example: a list containing "blossom 4" and "blossom bk 3" becomes "Blossom Book 4" and "Blossom Book 3" — infer that "Book" applies to the whole series.
  - Keep real series names, subjects, publishers and grade/level numbers (JSS 1, SSS 2, Primary 4, Book 2).
  - Remove bullet characters, leading list numbers and stray punctuation.
- "publisher": the publisher or imprint if named (e.g. Longman, Macmillan, Oxford, Evans, Learn Africa). Use null if none is named — never guess one from the series name alone.
- "costPrice": what the shop pays to buy the book, as a plain number in naira — no currency symbol, no commas. Only set this when the text distinguishes a buying/cost/wholesale price from a selling price, or explicitly labels a single price as cost. Otherwise null.
- "sellingPrice": what the shop charges its own customers, as a plain number in naira. This is the DEFAULT bucket for a price with no label — "1300 each", "sells for 1200", "N800", a bare number after the title — because a shopkeeper describing their own shelf is almost always stating what they sell at. Use null only if no price at all is given for that book.

CRITICAL — a price is NEVER below ₦150:
- No school book costs less than ₦150. Real prices are ₦150 or more, usually ₦500–₦10,000. A value under 150 is NEVER a price — treat it as a stray number (a page count, an edition, a list number) and leave both price fields null rather than force it into either.

EXPANDING RANGES — very important, and the most common shape of this input:
Shopkeepers describe a whole series in one line by naming a range of classes, grades or age brackets. When a line covers a range, output ONE book per step in that range (inclusive) — NOT a single combined line. Give every expanded line the SAME costPrice and SAME sellingPrice as the range line. So "Phonics and Spelling, 4-5 to 10-11, 2500 each" becomes seven separate books, each priced 2500.

Recognise these range styles and expand every step, whether the range is written with "to", "-", "–" or "through":
- Age brackets, stepping by ONE year: "4-5 to 10-11" → 4-5, 5-6, 6-7, 7-8, 8-9, 9-10, 10-11.
- Primary / class: "Primary 1 to 6", "class 1-6", "pry 1 to 6", "1 to 6" → Primary 1, Primary 2, … Primary 6.
- Nursery: "Nursery 1 to 3" → Nursery 1, Nursery 2, Nursery 3.
- Junior secondary: "JSS 1 to 3", "JS1 to JS3" → JSS 1, JSS 2, JSS 3.
- Senior secondary: "SSS 1 to 3", "SS1 to SS3" → SSS 1, SSS 2, SSS 3.
- Across junior and senior: "JSS 1 to SSS 3" → JSS 1, JSS 2, JSS 3, SSS 1, SSS 2, SSS 3.
This applies no matter what the book title is — "Bond Maths 4-5 to 6-7" expands to Bond Maths 4-5, Bond Maths 5-6, Bond Maths 6-7. A range with no price still expands; each step just has costPrice and sellingPrice null.

Naming the expanded books:
- Write the title, then a space, then the step: "Phonics and Spelling 4-5", "Bond Maths 5-6", "Understanding Mathematics Primary 3", "Oxford English JSS 2". Keep the exact same title wording on every line of the series.
- For age brackets write the bracket as digits with a hyphen ("4-5") — do NOT add words like "Ages", "Age" or "Years".

Do NOT expand when the items are a bundle sold at one per-set price (e.g. "maths set (primary 1-6), 12000 per set") — keep that as a single line, because the price is for the whole set, not per class.

If several unrelated books are described in one message, each with its own title and price, return each as its own line — do not merge them.

Never invent books, publishers or prices that aren't in the source. Ignore greetings and signatures. Return the books in the order they appear.`;

const nullable = (type: string) => ({ anyOf: [{ type }, { type: "null" }] });

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          publisher: nullable("string"),
          costPrice: nullable("number"),
          sellingPrice: nullable("number"),
        },
        required: ["name", "publisher", "costPrice", "sellingPrice"],
      },
    },
  },
  required: ["items"],
};

function buildContent(sources: Source[]): Anthropic.ContentBlockParam[] {
  const blocks: Anthropic.ContentBlockParam[] = [];
  const texts: string[] = [];

  for (const src of sources) {
    if (src.kind === "pdf") {
      blocks.push({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: src.base64 },
      });
    } else if (src.kind === "image") {
      blocks.push({
        type: "image",
        source: { type: "base64", media_type: src.media, data: src.base64 },
      });
    } else if (src.text) {
      texts.push(src.text);
    }
  }

  const fileCount = blocks.length;
  const parts: string[] = [];
  if (fileCount > 0) {
    parts.push(
      fileCount === 1
        ? "Read the books (and any prices and publisher) in this price list."
        : `These ${fileCount} files are pages or photos of the same price list. Read the books, prices and publisher from all of them into a single list, in the order they appear. Don't repeat a book that shows up on more than one page.`
    );
    if (texts.length) parts.push(`Also include the books described in this text:\n\n${texts.join("\n\n")}`);
  } else {
    parts.push(`Read the books described here:\n\n${texts.join("\n\n")}`);
  }

  blocks.push({ type: "text", text: parts.join("\n\n") });
  return blocks;
}

type RawItem = { name?: unknown; publisher?: unknown; costPrice?: unknown; sellingPrice?: unknown };
type RawResult = { items?: RawItem[] };

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "AI isn't set up yet — add ANTHROPIC_API_KEY to .env.local and restart." },
      { status: 503 }
    );
  }

  let sources: Source[];
  try {
    sources = await readSources(req, MAX_BYTES);
  } catch (err) {
    const status = err instanceof SourceError ? err.status : 400;
    const message = err instanceof SourceError ? err.message : "Couldn't read that input.";
    return NextResponse.json({ error: message }, { status });
  }

  if (!sources.length) {
    return NextResponse.json(
      { error: "Nothing to read — describe the books, or add a file." },
      { status: 400 }
    );
  }

  const client = new Anthropic();
  let raw: RawResult;
  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      // Reading a shelf description is routine work: medium keeps range
      // expansion and price attribution reliable without high-effort tokens.
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: SCHEMA },
      },
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: buildContent(sources) }],
    });

    if (message.stop_reason === "refusal") {
      return NextResponse.json(
        { error: "AI declined to read that. Try describing the books more plainly." },
        { status: 422 }
      );
    }

    const text = message.content.find((b) => b.type === "text");
    raw = text?.type === "text" ? (JSON.parse(text.text) as RawResult) : {};
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      return NextResponse.json({ error: "The Anthropic API key is invalid." }, { status: 502 });
    }
    if (err instanceof Anthropic.RateLimitError) {
      return NextResponse.json(
        { error: "AI is busy right now — try again in a moment." },
        { status: 429 }
      );
    }
    return NextResponse.json({ error: "AI couldn't read that. Please try again." }, { status: 502 });
  }

  const clampPrice = (v: unknown): number | null => {
    if (v == null) return null;
    const n = Math.max(0, Number(v) || 0);
    // A sub-floor "price" is a misread — drop it rather than shelve a ₦60 book.
    return n < MIN_PRICE ? null : n;
  };

  const parsed = (Array.isArray(raw.items) ? raw.items : [])
    .map((r) => ({
      name: String(r.name ?? "").trim(),
      publisher: typeof r.publisher === "string" ? r.publisher.trim() : "",
      costPrice: clampPrice(r.costPrice),
      sellingPrice: clampPrice(r.sellingPrice),
    }))
    .filter((it) => it.name);

  if (!parsed.length) {
    return NextResponse.json({ error: "AI couldn't find any books in that." }, { status: 422 });
  }

  // Flag a likely duplicate against the shelf, so the review step can warn
  // before a second copy of the same book gets created.
  const catalogue = (await (await booksCollection()).find({ archived: { $ne: true } }).limit(2000).toArray())
    .map(toBook);

  const items = parsed.map((it) => {
    const match = matchBook(it.name, catalogue);
    const book = match?.book;
    return {
      name: it.name,
      publisher: it.publisher,
      costPrice: it.costPrice ?? 0,
      sellingPrice: it.sellingPrice ?? 0,
      existing: book
        ? {
            id: book.id,
            name: book.name,
            publisher: book.publisher,
            category: book.category,
            costPrice: book.costPrice,
            sellingPrice: book.sellingPrice,
          }
        : null,
    };
  });

  return NextResponse.json({ items });
}
