"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  BookPlus,
  FileText,
  Loader2,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import Sheet from "@/components/Sheet";
import BookPicker from "@/components/BookPicker";
import { ErrorNote, Spine } from "@/components/ui";
import {
  createBook,
  createCustomer,
  createInvoice,
  extractOrder,
  type ExtractedBook,
  type ExtractedItem,
  type Extraction,
} from "@/lib/client";
import { formatMoney, lineTotal, type Line } from "@/lib/types";
import { today } from "@/lib/datetime";
import { spineColor } from "@/lib/spine";

const lineId = () => `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** An extracted item once it's editable in the review step. */
type Draft = {
  key: string;
  written: string; // the name that will go on the invoice — editable
  book: ExtractedBook | null; // a shelf book the user has accepted; null = new
  suggestion: ExtractedBook | null; // a shelf match on offer, until accepted or dismissed
  qty: number;
  unitPrice: number;
};

function toDrafts(items: ExtractedItem[]): Draft[] {
  return items.map((it, i) => ({
    key: `d${i}`,
    written: it.written,
    book: null,
    suggestion: it.suggestion,
    qty: it.quantity,
    unitPrice: it.price,
  }));
}

export default function ImportSheet({ onClose }: { onClose: () => void }) {
  const router = useRouter();

  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");

  const [result, setResult] = useState<Extraction | null>(null);
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [customer, setCustomer] = useState({ name: "", phone: "", address: "" });
  const [saveCustomer, setSaveCustomer] = useState(true);
  const [pickingFor, setPickingFor] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  async function read() {
    setReading(true);
    setError("");
    try {
      const extraction = await extractOrder({ text, files });
      setResult(extraction);
      setDrafts(toDrafts(extraction.items));
      setCustomer({
        name: extraction.customer.match?.name ?? extraction.customer.name,
        phone: extraction.customer.match?.phone || extraction.customer.phone,
        address: extraction.customer.match?.address || extraction.customer.address,
      });
      // An already-known school needs no second record.
      setSaveCustomer(!extraction.customer.match);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setReading(false);
    }
  }

  function patch(key: string, next: Partial<Draft>) {
    setDrafts((prev) => prev?.map((d) => (d.key === key ? { ...d, ...next } : d)) ?? null);
  }

  // Link a line to a shelf book — whether from the AI's suggestion or a manual
  // pick. Adopt the shelf's clean name, and fill the price from it only when
  // the source didn't already show one.
  function linkBook(key: string, book: ExtractedBook) {
    setDrafts((prev) =>
      prev?.map((d) =>
        d.key === key
          ? {
              ...d,
              book,
              suggestion: null,
              written: book.name,
              unitPrice: d.unitPrice > 0 ? d.unitPrice : book.sellingPrice,
            }
          : d
      ) ?? null
    );
  }

  function unlinkBook(key: string) {
    patch(key, { book: null });
  }

  async function create() {
    if (!drafts?.length) return;
    setCreating(true);
    setError("");
    try {
      let customerId = result?.customer.match?.id ?? null;
      if (!customerId && saveCustomer && customer.name.trim()) {
        customerId = (await createCustomer(customer)).id;
      }

      // A line the user linked to the shelf carries that book's id. A line
      // left as new gets added to the shelf now, so it's there next time and
      // its sales start being tracked.
      const lines: Line[] = await Promise.all(
        drafts.map(async (d) => {
          const name = d.written.trim();
          let book = d.book;
          if (!book && name) {
            const created = await createBook({ name, sellingPrice: d.unitPrice || 0 });
            book = {
              id: created.id,
              name: created.name,
              publisher: created.publisher,
              category: created.category,
              costPrice: created.costPrice,
              sellingPrice: created.sellingPrice,
            };
          }
          return {
            id: lineId(),
            bookId: book?.id ?? null,
            name: name || d.written,
            publisher: book?.publisher ?? "",
            category: book?.category ?? "",
            qty: d.qty,
            unitPrice: d.unitPrice,
            costPrice: book?.costPrice ?? 0,
          };
        })
      );

      const invoice = await createInvoice({
        date: today(),
        customerId,
        customerName: customer.name.trim(),
        customerPhone: customer.phone.trim(),
        customerAddress: customer.address.trim(),
        lines,
      });
      onClose();
      router.push(`/invoices/${invoice.id}`);
    } catch (e) {
      setError((e as Error).message);
      setCreating(false);
    }
  }

  /* -- Review step ------------------------------------------------------- */

  if (drafts) {
    const total = drafts.reduce((sum, d) => sum + lineTotal(d), 0);
    const copies = drafts.reduce((sum, d) => sum + d.qty, 0);
    const unmatched = drafts.filter((d) => !d.book).length;
    const noCost = drafts.filter((d) => d.book && !d.book.costPrice).length;

    return (
      <>
        <Sheet
          open
          title={`${drafts.length} ${drafts.length === 1 ? "book" : "books"} found`}
          onClose={onClose}
          footer={
            <div className="space-y-2">
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-[var(--ink-2)]">
                  {copies} {copies === 1 ? "copy" : "copies"}
                </span>
                <span className="figure text-lg">{formatMoney(total)}</span>
              </div>
              <button className="btn btn-ink w-full" onClick={create} disabled={creating}>
                {creating ? <Loader2 size={17} className="animate-spin" /> : null}
                {creating ? "Creating…" : "Create invoice"}
              </button>
            </div>
          }
        >
          {error && <ErrorNote>{error}</ErrorNote>}

          {/* School */}
          <div className="mb-4">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="eyebrow">Billed to</span>
              {result?.customer.match && (
                <span className="pill pill-paid">Already on file</span>
              )}
            </div>
            <input
              className="field font-medium"
              placeholder="School or customer name"
              value={customer.name}
              onChange={(e) => setCustomer({ ...customer, name: e.target.value })}
              aria-label="Customer name"
            />
            <div className="mt-2 grid grid-cols-2 gap-2">
              <input
                className="field"
                type="tel"
                placeholder="Phone"
                value={customer.phone}
                onChange={(e) => setCustomer({ ...customer, phone: e.target.value })}
                aria-label="Customer phone"
              />
              <input
                className="field"
                placeholder="Address"
                value={customer.address}
                onChange={(e) => setCustomer({ ...customer, address: e.target.value })}
                aria-label="Customer address"
              />
            </div>
            {!result?.customer.match && customer.name.trim() && (
              <label className="mt-2 flex items-center gap-2 text-xs text-[var(--ink-2)]">
                <input
                  type="checkbox"
                  checked={saveCustomer}
                  onChange={(e) => setSaveCustomer(e.target.checked)}
                />
                Add this school to my records, so their history builds up
              </label>
            )}
          </div>

          {/* Books */}
          <span className="eyebrow">Books</span>
          <ul className="mt-2 space-y-2">
            {drafts.map((d) => (
              <li key={d.key} className="card flex gap-2.5 p-2.5">
                <Spine color={d.book ? spineColor(d.book.publisher) : "var(--rule-strong)"} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start gap-2">
                    <input
                      className="field flex-1 py-1 text-sm font-medium"
                      value={d.written}
                      onChange={(e) => patch(d.key, { written: e.target.value })}
                      aria-label="Book name"
                    />
                    <button
                      aria-label="Remove book"
                      className="mt-1 rounded-lg p-1 text-[var(--ink-3)] hover:bg-[var(--sunken)] hover:text-[var(--debit)]"
                      onClick={() => setDrafts(drafts.filter((x) => x.key !== d.key))}
                    >
                      <X size={16} />
                    </button>
                  </div>

                  {/* Linked to the shelf */}
                  {d.book && (
                    <div className="mt-1.5 flex items-center gap-2 text-xs">
                      <span className="text-[var(--credit)]">
                        ✓ On the shelf{d.book.publisher ? ` · ${d.book.publisher}` : ""}
                      </span>
                      <button
                        className="text-[var(--ink-3)] underline underline-offset-2"
                        onClick={() => unlinkBook(d.key)}
                      >
                        keep as new
                      </button>
                    </div>
                  )}

                  {/* A suggestion the user can take or leave */}
                  {!d.book && d.suggestion && (
                    <div className="mt-1.5 rounded-lg bg-[var(--sunken)] px-2.5 py-2 text-xs">
                      <span className="text-[var(--ink-2)]">Did you mean </span>
                      <span className="font-medium">{d.suggestion.name}</span>
                      <span className="text-[var(--ink-3)]">
                        {d.suggestion.publisher ? ` · ${d.suggestion.publisher}` : ""}
                        {d.suggestion.sellingPrice > 0 ? ` · ${formatMoney(d.suggestion.sellingPrice)}` : ""}
                      </span>
                      <span className="text-[var(--ink-2)]">?</span>
                      <div className="mt-1.5 flex gap-2">
                        <button
                          className="font-semibold text-[var(--gold)]"
                          onClick={() => linkBook(d.key, d.suggestion!)}
                        >
                          Use this
                        </button>
                        <button
                          className="text-[var(--ink-3)]"
                          onClick={() => patch(d.key, { suggestion: null })}
                        >
                          No, keep mine
                        </button>
                      </div>
                    </div>
                  )}

                  {/* New book, no suggestion */}
                  {!d.book && !d.suggestion && (
                    <button
                      className="btn btn-quiet mt-1.5 w-full py-1 text-xs"
                      onClick={() => setPickingFor(d.key)}
                    >
                      <BookPlus size={14} /> New book — or match one on the shelf
                    </button>
                  )}

                  <div className="mt-2 flex items-center gap-2">
                    <input
                      className="field figure w-16 py-1 text-right"
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={d.qty}
                      onChange={(e) => patch(d.key, { qty: Math.max(0, Number(e.target.value) || 0) })}
                      aria-label="Quantity"
                    />
                    <span className="text-sm text-[var(--ink-3)]">×</span>
                    <span className="text-sm text-[var(--ink-3)]">₦</span>
                    <input
                      className="field figure min-w-0 flex-1 py-1 text-right"
                      type="number"
                      inputMode="decimal"
                      min={0}
                      value={d.unitPrice}
                      onChange={(e) => patch(d.key, { unitPrice: Math.max(0, Number(e.target.value) || 0) })}
                      aria-label="Unit price"
                    />
                    <span className="figure w-24 shrink-0 text-right text-sm font-semibold">
                      {formatMoney(lineTotal({ qty: d.qty, unitPrice: d.unitPrice }))}
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ul>

          {/* Say plainly what won't be tracked, rather than let it surface as a
              wrong profit figure later. */}
          {(unmatched > 0 || noCost > 0) && (
            <div className="card mt-3 px-3.5 py-3 text-xs text-[var(--ink-2)]">
              {unmatched > 0 && (
                <p>
                  <span className="font-semibold text-[var(--ink)]">
                    {unmatched} {unmatched === 1 ? "book isn't" : "books aren't"} on your shelf yet.
                  </span>{" "}
                  {unmatched === 1 ? "It" : "They"}&rsquo;ll be added automatically when you create
                  the invoice, but with no cost price {unmatched === 1 ? "it counts" : "they count"}{" "}
                  as pure profit until you set one on the Books tab. Match{" "}
                  {unmatched === 1 ? "it" : "them"} above to use an existing book instead.
                </p>
              )}
              {noCost > 0 && (
                <p className={unmatched > 0 ? "mt-1.5" : ""}>
                  {noCost} matched {noCost === 1 ? "book has" : "books have"} no cost price recorded
                  — add one on the Books tab and future invoices will report real profit.
                </p>
              )}
            </div>
          )}
        </Sheet>

        {pickingFor && (
          <BookPicker
            onClose={() => setPickingFor(null)}
            onPick={(book) => {
              linkBook(pickingFor, {
                id: book.id,
                name: book.name,
                publisher: book.publisher,
                category: book.category,
                costPrice: book.costPrice,
                sellingPrice: book.sellingPrice,
              });
              setPickingFor(null);
            }}
          />
        )}
      </>
    );
  }

  /* -- Source step ------------------------------------------------------- */

  return (
    <Sheet
      open
      title="Build from a list"
      onClose={onClose}
      footer={
        <button
          className="btn btn-ink w-full"
          onClick={read}
          disabled={reading || (!files.length && !text.trim())}
        >
          {reading ? <Loader2 size={17} className="animate-spin" /> : <Sparkles size={17} />}
          {reading ? "Reading the order…" : "Read the order"}
        </button>
      }
    >
      <p className="flex items-start gap-2 text-sm text-[var(--ink-2)]">
        <Sparkles size={16} className="mt-0.5 shrink-0 text-[var(--gold)]" />
        Paste a school&rsquo;s order, or add photos of a written list — as many pages as you like.
        Each book is matched to your shelf, so prices, publisher and cost come across with it.
      </p>

      <label className="mt-3 flex cursor-pointer flex-col items-center rounded-xl border border-dashed border-[var(--rule-strong)] px-4 py-7 text-center hover:border-[var(--gold)]">
        <Upload size={24} className="text-[var(--gold)]" />
        <span className="mt-2 text-sm font-semibold">
          {files.length ? "Add more files" : "Add photos, a PDF or a Word file"}
        </span>
        <span className="text-xs text-[var(--ink-3)]">Photo · PDF · DOCX · TXT</span>
        <input
          type="file"
          accept="image/*,.pdf,.docx,.txt,.md,application/pdf"
          multiple
          className="hidden"
          onChange={(e) => {
            const picked = Array.from(e.target.files ?? []);
            if (picked.length) setFiles((prev) => [...prev, ...picked]);
            setError("");
            e.target.value = ""; // let the same file be picked again
          }}
        />
      </label>

      {files.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {files.map((f, i) => (
            <li
              key={`${f.name}-${f.size}-${i}`}
              className="flex items-center gap-2 rounded-lg bg-[var(--sunken)] px-3 py-2 text-sm"
            >
              <FileText size={15} className="shrink-0 text-[var(--ink-3)]" />
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              <button
                type="button"
                aria-label={`Remove ${f.name}`}
                className="shrink-0 text-[var(--ink-3)] hover:text-[var(--debit)]"
                onClick={() => setFiles(files.filter((_, j) => j !== i))}
              >
                <X size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="my-3 flex items-center gap-3">
        <span className="h-px flex-1 bg-[var(--rule)]" />
        <span className="text-xs text-[var(--ink-3)]">or paste the list</span>
        <span className="h-px flex-1 bg-[var(--rule)]" />
      </div>

      <textarea
        className="field"
        rows={6}
        placeholder={"ABC International School\n\n40 Oxford Maths bk 5\n25 Cambridge Eng 4\n60 Lantern Basic Sci 2"}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setError("");
        }}
        aria-label="Paste the order"
      />

      {error && (
        <div className="mt-3">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
    </Sheet>
  );
}
