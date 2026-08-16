# CTY Booksource

Invoicing and sales records for a wholesale schoolbook business. Mobile-first:
Next.js 16 (App Router) · TypeScript · Tailwind v4 · MongoDB.

Built from the same bones as `../invoicer`, but a different app — this one keeps
customer, product and profit records, and reports on them.

```bash
npm run dev          # http://localhost:3000
node scripts/seed.mjs        # ~7 months of plausible trade, via the API
node scripts/verify.mjs      # walk every screen + the export paths in a real browser
node scripts/flow.mjs        # write an invoice through the UI, check what was saved
node scripts/import-flow.mjs # same, but via the AI import
node scripts/shots.mjs       # screenshot every screen to /tmp/pbshots
```

`.env.local` holds `MONGODB_URI`, `MONGODB_DB` (default `bookDB`) and
`ANTHROPIC_API_KEY`. It's gitignored — copy the pattern from `.env.local` when
moving to another machine. Without the Anthropic key everything works except
the AI import, which says so rather than failing obscurely.

## The two rules that shape the data model

**No stock.** Books are names and prices, nothing else. Selling a book never
decrements anything. "Which books sell the most" is answered from invoice
history, not from an inventory count.

**Every book has two names.** A short name (what prints on the invoice) and a
full title (the official one, for when a school asks). Each invoice line carries
a `nameMode` and a Short/Full toggle, so a single line can print the long title
while the rest stay short. The default for new lines is a device setting.

## Collections

| Collection | Holds |
|---|---|
| `invoices` | the ledger — lines, payments, totals, status |
| `customers` | schools and bookshops |
| `books` | the catalogue: short name, full title, publisher, subject, cost & selling price |
| `counters` | one doc, `invoiceNumber`, incremented atomically so numbers never collide |

### Invoice lines snapshot their book

A line stores the book's names, publisher, selling price **and cost price as
they were at the time of sale**. Editing a book later never rewrites history,
and profit on an old invoice stays correct. The same is true of the customer's
name, phone and address.

The one deliberate exception: editing a customer pushes the corrected name and
contact details onto their existing invoices, because editing a customer is a
correction ("ABC Schl" → "ABC School") and searching invoices by school name
should find the old ones under the new spelling.

### Money is computed server-side, never sent by the client

`PATCH /api/invoices/:id` takes lines, discount and payments, then recomputes
`totals`, `amountPaid`, `balance` and `payStatus` itself. They're stored on the
document so list filtering and the analytics pipelines stay simple and fast.

### Invoice status

`draft` → `open` → (optionally) `cancelled`.

An invoice promotes itself from draft to open as soon as it names a customer and
has a line with a quantity — there's no "confirm" step to forget. **Only `open`
invoices count towards any figure anywhere.** Drafts and cancelled invoices are
excluded from every report; the ledger screen links to unfinished drafts so none
get lost.

## Reports

`GET /api/analytics?period=…` returns one bundle: KPIs and period-over-period
growth, a sales/collections series, ranked products, slow movers, ranked
customers, dormant customers, receivables ageing, and profit split by publisher
and subject. `GET /api/analytics/overview` is the smaller bundle for the home
screen.

Two things worth knowing about the numbers:

- **Cash is dated by the payment, not the invoice.** A July invoice paid in
  August is August's "collected".
- **A whole-invoice discount is spread proportionally across its lines.**
  Without that, per-product revenue would add up to more than the invoices it
  came from. (`node scripts/seed.mjs` then cross-footing publisher revenue
  against total sales is the check.)

Profit assumes the cost price recorded on each book. Books with no cost price
count as pure profit, which the Profit tab says out loud.

## AI import — a pasted list or a photo becomes an invoice

`POST /api/extract` takes pasted text and/or files (photos, PDF, DOCX, TXT —
several at once, treated as pages of one order) and returns invoice lines plus
the customer. It runs `claude-opus-5` at `medium` effort with structured
outputs, so the response is schema-valid JSON rather than something to regex.

**The extraction is only half the feature — the matching is the other half.**
Each written title is matched against the book catalogue (`src/lib/match.ts`),
so a line arrives carrying the book's id, publisher and **cost price**. Without
that, an imported invoice would land in the reports as untracked free text with
no cost, silently inflating profit. The review step says out loud when a book
couldn't be matched, and offers to match it by hand.

The matcher is deliberately conservative — a wrong match is worse than no match,
because it books the wrong cost price into the profit figures:

- Level numbers are absolute. "Book 5" never matches "Book 6", and a title with
  no level never matches one with a level. This is the single most important
  rule for schoolbooks.
- Nigerian list shorthand is normalised on both sides (`bk`→book, `pry`→primary,
  `maths`→mathematics, `jss2`→`jss 2`), then scored by symmetric token overlap
  with a 0.5 floor — so a shared publisher alone is never enough.

Two prompt rules earn their keep and should not be softened:

- **No school book costs less than ₦150.** A bare number under 150 is a
  quantity, not a price — `"Evans CRS 5 .... 48"` means 48 copies. The server
  re-checks this after the model and moves any sub-floor "price" into the
  quantity slot.
- When a row shows two numbers, the larger is the price and the smaller is the
  quantity.

The customer is matched against existing schools too, so a repeat order attaches
to the record it belongs to instead of creating a near-duplicate.

## Design

One metaphor: the hardcover sales ledger the business already keeps. Figures set
in tabular mono so columns align on a phone; black ink for normal, red for money
owed, green for money in — the same convention as the paper book.

The signature device is the **publisher spine**: each publisher gets a colour
derived from its name (`src/lib/spine.ts`), shown as a thin bar beside every
book row and invoice line, and reused as the series colour in the publisher
charts. Same publisher, same colour, everywhere. The palette passes the
colour-vision, chroma and contrast checks; every ranked row is also directly
labelled, so identity is never carried by colour alone.

Committed light-only — the subject is paper.

## PDF export

`POST /api/invoices/:id/pdf` renders the invoice server-side with
`@react-pdf/renderer` and returns the bytes. The letterhead (business name,
phone, email, address and which of them to show) is a device setting, so the
client posts it with the request.

Two reasons it isn't done in the browser: the client build of the renderer never
settled its `toBlob()` promise here, and keeping it off the client saves about a
megabyte of JavaScript on a phone.

`public/fonts/` holds the TTFs the PDF registers. They are **not optional** —
the PDF base-14 fonts (Helvetica, Courier, Times) are Latin-1 only and have no
₦, so every figure came out with a broken glyph. Take them from the official IBM
release (`github.com/IBM/plex`), not from Google Fonts: the Google static
instances of IBM Plex Mono crash react-pdf's subsetter with `Offset is outside
the bounds of the DataView`, and Google's `latin` subsets drop ₦ from most
families anyway.

## Sharing

The share sheet offers PDF, image (via `html-to-image`), print, WhatsApp and
email. `shareFile()` races `navigator.share` against a timeout and falls back to
a download: building the file takes an await, which spends the click's user
activation, after which `navigator.share()` can reject or simply never settle.
