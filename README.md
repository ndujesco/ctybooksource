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

**A book is just a name, publisher and two prices** (cost and selling). Adding a
book asks for exactly those; there is no short/long-name split. An invoice line
snapshots the book's name and prices at the time of sale, so editing a book
later never rewrites history.

## Collections

| Collection | Holds |
|---|---|
| `invoices` | the ledger — lines, payments, totals, status |
| `customers` | schools and bookshops |
| `books` | the catalogue: name, publisher, cost & selling price (subject kept for the by-subject report) |
| `bookPrices` | one row per (school, book) that has a price of its own |
| `counters` | one doc, `invoiceNumber`, incremented atomically so numbers never collide |

### Invoice lines snapshot their book

A line stores the book's name, publisher, selling price **and cost price as
they were at the time of sale**. Editing a book later never rewrites history,
and profit on an old invoice stays correct. The same is true of the customer's
name, phone and address.

The one deliberate exception: editing a customer pushes the corrected name and
contact details onto their existing invoices, because editing a customer is a
correction ("ABC Schl" → "ABC School") and searching invoices by school name
should find the old ones under the new spelling.

## Two prices for one book: general, and this school's

A book carries one **general** price. Any school that has negotiated its own
rate gets a row in `bookPrices`, and **that price wins** whenever that school is
being invoiced — on a hand-written invoice, and on an order read in by the AI.

The rule that makes it safe to edit prices on an invoice at all:

> **Editing a price on an invoice changes that invoice and nothing else.**

When the typed price departs from the standing one, the line offers — and only
offers — two ways to remember it: *always this price for this school*, or
*change the general price*. Ignore both and the edit stays on this invoice. A
school's whole price list is on their record under **Prices**, where it can be
changed or dropped.

`POST /api/extract` reads the school first and the books second, precisely so
the suggestions come back priced at that school's rates. A price written on the
order itself is the school's own instruction and is never overwritten by a
stored one.

## Balance brought forward

A new invoice can show what the school still owes on their earlier ones.
**It is a switch, never automatic** — `carryForward` on the invoice — and it only
appears when there is something to carry.

`broughtForward` is recomputed server-side on every save from the school's other
open invoices, so paying one of those off drops the figure here by itself; it is
never a stale snapshot, and never taken from the client.

The arrears are **shown beneath this invoice's own figures, never folded into
them**:

```
Grand total          ₦412,500
Amount paid          ₦200,000
Balance on this inv. ₦212,500
──────────────────────────────
Brought forward      ₦ 86,000
TOTAL DUE            ₦298,500
```

That is deliberate. The debt belongs to the invoices that raised it; adding it
into this invoice's `totals` or `balance` would count the same money twice in
every report, and leave two invoices each claiming the same ₦86,000.

## Joining duplicate books

The shelf has the same title on it more than once — `Bond Non-Verbal 6-7` beside
`Bond Non-Verbal. 6-7`, `Fun Science Nur. 1` beside `Fun Science Nursery 1`,
`NELSON SPELLING WORKBOOK 1A` beside `Nelson Spelling Workbook 1A`. While they
sit apart, each shows half the copies actually sold.

`src/lib/booknames.ts` reduces a written title to what it actually names, so the
spellings land on one key. It is strict about the one thing that must not be
smudged: **level numbers**. `Book 5` never meets `Book 6`, and `1A` never meets
`1B`.

**The sales move before anything is deleted.** `POST /api/books/merge` repoints
every invoice line onto the survivor and relabels it with the survivor's name
and publisher; only then is the duplicate record removed. Deliberately left
alone on those lines: `unitPrice` and `costPrice` — they are the prices the sale
actually happened at, and rewriting them would falsify profit on invoices
settled months ago. School prices come across too, unless the survivor already
has one for that school.

Detection only ever *proposes*; the survivor it suggests is the record that
knows the most (a publisher first — the hand-typed duplicates are the ones
missing it). A book filed under a different name altogether (`Mental Arithmetic
3` belonging with `S/Sims Mental Arithmetic 3`) can't be detected, so there is a
plain search-and-pick beside it.

## The grand invoice

`/reports/grand` — not one school's invoice, but every copy of every book that
left the building in a period, on one sheet. Each title opens to show the
schools that took it; the whole sheet can be read by school instead, or narrowed
to one. It prints.

## Writing an invoice on a desktop screen

Above 1100px the editor opens out and the finished document sits beside the
form, moving as you type. It is the *same component* that prints and that the
share sheet exports, so there is no second version of the truth to drift. The
phone layout is untouched.

## Autosave

`src/lib/use-autosave.ts`. Four things go wrong with a naive debounce, and the
hook exists for all four:

- An edit made **while a save is in flight** is held and sent the moment that
  flight lands — the newest state always wins.
- **Only one request is ever in the air**, so the server applies changes in the
  order they were typed.
- A failed save **retries on a backoff, retries at once when the network comes
  back**, and says plainly that it hasn't saved — the localStorage mirror holds
  the work meanwhile. `saveInvoice` throws rather than returning `null`, because
  a save that fails silently is how a typed invoice goes missing.
- Leaving the page, or unmounting mid-debounce, flushes with `keepalive` so the
  request outlives the page.

### Money is computed server-side, never sent by the client

`PATCH /api/invoices/:id` takes lines, discount and payments, then recomputes
`totals`, `amountPaid`, `balance` and `payStatus` itself. They're stored on the
document so list filtering and the analytics pipelines stay simple and fast.

### Invoice status

`draft` → `open` → (optionally) `cancelled`.

An invoice promotes itself from draft to open as soon as it names a customer and
has a line with a quantity — there's no "confirm" step to forget. **Only `open`
invoices count towards any figure anywhere.** Drafts and cancelled invoices are
excluded from every report; the invoices screen flags unfinished drafts so none get lost.

## Home

There is no separate dashboard — `/` redirects to the invoices list, which is the
home screen. New invoice, the AI import, and search all live there.

## Reports

`GET /api/analytics?period=…` returns one bundle: KPIs and period-over-period
growth, a sales/collections series, ranked products, slow movers, ranked
customers, dormant customers, receivables ageing, and profit split by publisher
and subject.

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
