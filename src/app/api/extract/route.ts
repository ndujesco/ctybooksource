import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import mammoth from "mammoth";
import { books as booksCollection, customers as customersCollection } from "@/lib/mongodb";
import { toBook, toCustomer } from "@/lib/serialize";
import { matchBook } from "@/lib/match";
import { escapeRegex } from "@/lib/serialize";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const MODEL = "claude-opus-5";
const MAX_BYTES = 30 * 1024 * 1024; // the Anthropic request limit is ~32MB across all files
const MIN_PRICE = 150; // no school book costs less than ₦150 — smaller numbers are quantities

const SYSTEM = `You turn a customer's book order into structured invoice lines for a Nigerian schoolbook wholesaler.

Context: the items are almost always primary- and secondary-school books — textbooks, workbooks and exercise books. Use that context to read and clean up each title.

For each book:
- "name": the book title, written cleanly and professionally.
  - Use proper Title Case even if the source is lowercase, abbreviated or messy.
  - Normalise abbreviations CONSISTENTLY across all items. If some items in a series spell a word out and others abbreviate it, apply the same form to every item in that series. In particular treat "bk" as "Book". Example: a list containing "blossom 4" and "blossom bk 3" becomes "Blossom Book 4" and "Blossom Book 3" — infer that "Book" applies to the whole series.
  - Keep real series names, subjects, publishers and grade/level numbers (JSS 1, SSS 2, Primary 4, Book 2).
  - Remove bullet characters, leading list numbers and stray punctuation.
- "quantity": the number of copies ordered, as an integer, only if it is stated. If no quantity is given, use null.
- "price": the UNIT PRICE in naira as a plain number — no currency symbol, no commas (e.g. 1800) — only if the source shows one (for example on a photographed invoice or price list). If no price is shown, use null.

CRITICAL — a price is NEVER below ₦150:
- No school book costs less than ₦150. Real prices are ₦150 or more, usually ₦500–₦10,000. This is a hard rule: a value under 150 is NEVER a price.
- So any bare number under 150 — including 45, 48, 50, 56, 60, 99 or 120 — is a QUANTITY (how many copies), not a price. Put it in "quantity" and leave "price" null. Do this even when it is the only number on the line and looks like it could be a price: "Maths Book 2 .... 60" means quantity 60, no price.
- A quantity is how many copies; a price is money per copy. If a row shows two numbers (e.g. "50  1,800"), the value of 150 or more is the price and the smaller one is the quantity.
- Never put a value under 150 in "price", and never default quantity to 1 when a number is shown — that number IS the quantity.

Also pull out the customer when the source names one:
- "customerName": the school, bookshop or person the order is for. Nigerian school names often end in School, College, Academy, Schools, Nursery/Primary, or Bookshop. Use null if no customer is named.
- "customerPhone": their phone number if one appears, else null.
- "customerAddress": their address if one appears, else null.

Never invent books, quantities, prices or customer details that aren't in the source. Ignore greetings, running totals, headings, page numbers and signatures. Return the books in the order they appear.`;

// Nullable fields keep the schema strict while letting the model say "not stated".
const nullable = (type: string) => ({ anyOf: [{ type }, { type: "null" }] });

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    customerName: nullable("string"),
    customerPhone: nullable("string"),
    customerAddress: nullable("string"),
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          quantity: nullable("integer"),
          price: nullable("number"),
        },
        required: ["name", "quantity", "price"],
      },
    },
  },
  required: ["customerName", "customerPhone", "customerAddress", "items"],
};

type ImageMedia = "image/jpeg" | "image/png" | "image/gif" | "image/webp";
type Source =
  | { kind: "text"; text: string }
  | { kind: "pdf"; base64: string }
  | { kind: "image"; base64: string; media: ImageMedia };

function imageMedia(name: string, type: string): ImageMedia {
  if (type === "image/png" || name.endsWith(".png")) return "image/png";
  if (type === "image/webp" || name.endsWith(".webp")) return "image/webp";
  if (type === "image/gif" || name.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

/**
 * Fold any number of photos, PDFs and pasted text into one user message. The
 * API takes multiple image and document blocks natively, so several photos of
 * one order go in as separate blocks — no need to stitch them into a PDF.
 */
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
        ? "Read the book order in this file — include the unit price shown for each book, and the customer if one is named."
        : `These ${fileCount} files are pages or photos of the same order. Read the books (and any unit prices, and the customer if one is named) from all of them into a single list, in the order they appear. Don't repeat a book that shows up on more than one page.`
    );
    if (texts.length) parts.push(`Also include the books from this list:\n\n${texts.join("\n\n")}`);
  } else {
    parts.push(`Read the book order in this list:\n\n${texts.join("\n\n")}`);
  }

  blocks.push({ type: "text", text: parts.join("\n\n") });
  return blocks;
}

type RawItem = { name?: unknown; quantity?: unknown; price?: unknown };
type RawResult = {
  customerName?: unknown;
  customerPhone?: unknown;
  customerAddress?: unknown;
  items?: RawItem[];
};

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "AI isn't set up yet — add ANTHROPIC_API_KEY to .env.local and restart." },
      { status: 503 }
    );
  }

  const sources: Source[] = [];
  try {
    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const body = await req.json();
      const text = String(body?.text ?? "").trim();
      if (text) sources.push({ kind: "text", text });
    } else {
      const form = await req.formData();
      const files = form.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);
      const text = form.get("text");

      let total = 0;
      for (const file of files) {
        total += file.size;
        if (total > MAX_BYTES) {
          return NextResponse.json(
            { error: "Those files are too large together (max 30MB)." },
            { status: 413 }
          );
        }
        const name = file.name.toLowerCase();
        const buf = Buffer.from(await file.arrayBuffer());
        const isImage = file.type.startsWith("image/") || /\.(jpe?g|png|gif|webp)$/.test(name);

        if (name.endsWith(".pdf") || file.type === "application/pdf") {
          sources.push({ kind: "pdf", base64: buf.toString("base64") });
        } else if (isImage) {
          sources.push({
            kind: "image",
            base64: buf.toString("base64"),
            media: imageMedia(name, file.type),
          });
        } else if (name.endsWith(".docx")) {
          const { value } = await mammoth.extractRawText({ buffer: buf });
          if (value.trim()) sources.push({ kind: "text", text: value.trim() });
        } else {
          const plain = buf.toString("utf-8").trim();
          if (plain) sources.push({ kind: "text", text: plain });
        }
      }

      if (typeof text === "string" && text.trim()) {
        sources.push({ kind: "text", text: text.trim() });
      }
    }
  } catch {
    return NextResponse.json({ error: "Couldn't read that input." }, { status: 400 });
  }

  if (!sources.length) {
    return NextResponse.json(
      { error: "Nothing to read — paste a list or add a file." },
      { status: 400 }
    );
  }

  const client = new Anthropic();
  let raw: RawResult;
  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      // Extraction is routine work: medium keeps it accurate on messy
      // handwriting without spending high-effort tokens on it.
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: SCHEMA },
      },
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: buildContent(sources) }],
    });

    if (message.stop_reason === "refusal") {
      return NextResponse.json(
        { error: "AI declined to read that. Try a clearer photo or paste the list as text." },
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

  const parsed = (Array.isArray(raw.items) ? raw.items : [])
    .map((r) => {
      let quantity = r.quantity == null ? null : Math.max(1, Math.round(Number(r.quantity) || 1));
      let price = r.price == null ? null : Math.max(0, Number(r.price) || 0);
      // A sub-floor "price" is a misread quantity. Move it across when that
      // slot is empty; otherwise drop it rather than invoice ₦60 a copy.
      if (price != null && price < MIN_PRICE) {
        if (quantity == null) quantity = Math.max(1, Math.round(price));
        price = null;
      }
      return { name: String(r.name ?? "").trim(), quantity, price };
    })
    .filter((it) => it.name);

  if (!parsed.length) {
    return NextResponse.json({ error: "AI couldn't find any books in that." }, { status: 422 });
  }

  // Match each written title against the shelf, so the line carries the book's
  // id, publisher and cost price into the invoice.
  const catalogue = (await (await booksCollection()).find({ archived: { $ne: true } }).limit(2000).toArray())
    .map(toBook);

  const items = parsed.map((it) => {
    const match = matchBook(it.name, catalogue);
    const book = match?.book;
    return {
      written: it.name,
      quantity: it.quantity ?? 1,
      // The catalogue's selling price wins when the source didn't show one.
      price: it.price ?? book?.sellingPrice ?? 0,
      priceFromCatalogue: it.price == null && !!book?.sellingPrice,
      book: book
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

  const customerName = typeof raw.customerName === "string" ? raw.customerName.trim() : "";
  const customer = {
    name: customerName,
    phone: typeof raw.customerPhone === "string" ? raw.customerPhone.trim() : "",
    address: typeof raw.customerAddress === "string" ? raw.customerAddress.trim() : "",
    // If this school is already on file, use their record rather than creating
    // a near-duplicate — that's what keeps their history in one place.
    match: customerName ? await findCustomer(customerName) : null,
  };

  return NextResponse.json({ customer, items });
}

/** Look for an existing customer whose name contains (or is contained by) the written one. */
async function findCustomer(written: string) {
  const col = await customersCollection();
  const doc = await col.findOne({
    archived: { $ne: true },
    name: { $regex: escapeRegex(written), $options: "i" },
  });
  if (doc) return toCustomer(doc);

  // "ABC School" written as "ABC" — try the leading word or two.
  const lead = written.split(/\s+/).slice(0, 2).join(" ");
  if (lead.length < 3) return null;
  const loose = await col.findOne({
    archived: { $ne: true },
    name: { $regex: `^${escapeRegex(lead)}`, $options: "i" },
  });
  return loose ? toCustomer(loose) : null;
}
