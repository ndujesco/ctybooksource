"use client";

import { useEffect, useState } from "react";
import { BookPlus, Search } from "lucide-react";
import Sheet from "@/components/Sheet";
import { createBook, listBooks } from "@/lib/client";
import { formatMoney, type Book } from "@/lib/types";
import { spineColor } from "@/lib/spine";
import { ErrorNote, Labelled, Spine } from "@/components/ui";

/**
 * Pick a book off the shelf — the book name is what you search and what lands
 * on the invoice.
 */
// Mounted only while open (see the callers), so the search box and the
// add-a-book form reset themselves on close without an effect to do it.
export default function BookPicker({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (book: Book) => void;
}) {
  const [q, setQ] = useState("");
  const [books, setBooks] = useState<Book[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const t = setTimeout(() => {
      setError("");
      listBooks(q)
        .then(setBooks)
        .catch((e: Error) => setError(e.message));
    }, q ? 200 : 0);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <Sheet open title={adding ? "Add a book" : "Choose a book"} onClose={onClose}>
      {error && <ErrorNote>{error}</ErrorNote>}

      {adding ? (
        <NewBookForm
          initialName={q}
          onCancel={() => setAdding(false)}
          onCreated={(b) => {
            onPick(b);
            onClose();
          }}
        />
      ) : (
        <>
          <div className="relative">
            <Search
              size={16}
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[var(--ink-3)]"
            />
            <input
              className="field pl-9"
              placeholder="Book name or publisher"
              value={q}
              autoFocus
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search books"
            />
          </div>

          <button className="btn btn-quiet mt-2 w-full" onClick={() => setAdding(true)}>
            <BookPlus size={17} /> Add a new book
          </button>

          <ul className="ruled mt-3">
            {(books || []).map((b) => (
              <li key={b.id}>
                <button
                  className="flex w-full items-center gap-3 py-2.5 text-left"
                  onClick={() => {
                    onPick(b);
                    onClose();
                  }}
                >
                  <Spine color={spineColor(b.publisher)} title={b.publisher} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{b.name}</span>
                    <span className="block truncate text-xs text-[var(--ink-3)]">
                      {b.publisher || "No publisher"}
                    </span>
                  </span>
                  <span className="figure shrink-0 text-sm">{formatMoney(b.sellingPrice)}</span>
                </button>
              </li>
            ))}
          </ul>

          {books && books.length === 0 && (
            <p className="py-6 text-center text-sm text-[var(--ink-3)]">
              {q ? `No book matches “${q}”.` : "The shelf is empty."} Add it above and it stays on
              the shelf for next time.
            </p>
          )}
        </>
      )}
    </Sheet>
  );
}

/* A book series can span a whole set of classes or age brackets. Picking a
   range creates one book per step, e.g. "Understanding Maths" →
   "Understanding Maths Class 1" … "Class 6", or "Bond" → "Bond 4-5" …
   "Bond 11-12", all sharing the price you typed.

   Two families:
   • Class 0–6 (choose any span within it)
   • Age brackets 4-5 … 11-12, for books like Bond (choose any span) */
type RangeFamily = "none" | "class" | "secondary" | "age";

const CLASS_UNITS = ["Class 0", "Class 1", "Class 2", "Class 3", "Class 4", "Class 5", "Class 6"];
const AGE_UNITS = ["4-5", "5-6", "6-7", "7-8", "8-9", "9-10", "10-11", "11-12"];
const SECONDARY_UNITS = ["JSS 1", "JSS 2", "JSS 3", "SSS 1", "SSS 2", "SSS 3"];

const RANGE_FAMILIES: { value: RangeFamily; label: string; units: string[] }[] = [
  { value: "none", label: "Just this book", units: [] },
  { value: "class", label: "Class 0–6", units: CLASS_UNITS },
  { value: "secondary", label: "JSS 1 to SSS 3", units: SECONDARY_UNITS },
  { value: "age", label: "Age 4-5 to 11-12 (Bond, etc.)", units: AGE_UNITS },
];

export function NewBookForm({
  initialName = "",
  onCreated,
  onCancel,
  allowRange = false,
}: {
  initialName?: string;
  onCreated: (b: Book) => void;
  onCancel?: () => void;
  allowRange?: boolean;
}) {
  const [form, setForm] = useState({
    name: initialName,
    publisher: "",
    costPrice: "",
    sellingPrice: "",
  });
  const [family, setFamily] = useState<RangeFamily>("none");
  const [from, setFrom] = useState(0);
  const [to, setTo] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const units = RANGE_FAMILIES.find((r) => r.value === family)?.units ?? [];
  const baseName = form.name.trim();
  // Guard the span even if the two selects momentarily cross.
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const span = units.length ? units.slice(lo, hi + 1) : [];
  // The exact list of book names that will be created.
  const names = span.length ? span.map((u) => `${baseName} ${u}`) : [baseName];

  function pickFamily(next: RangeFamily) {
    const nextUnits = RANGE_FAMILIES.find((r) => r.value === next)?.units ?? [];
    setFamily(next);
    setFrom(0);
    setTo(nextUnits.length ? nextUnits.length - 1 : 0);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!baseName) return;
    setSaving(true);
    setError("");
    try {
      const payload = {
        publisher: form.publisher.trim(),
        costPrice: Number(form.costPrice) || 0,
        sellingPrice: Number(form.sellingPrice) || 0,
      };
      // Create every book in the range with the same price; keep the first to
      // hand back to callers that add straight to an invoice.
      const created = await Promise.all(names.map((name) => createBook({ ...payload, name })));
      onCreated(created[0]);
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {error && <ErrorNote>{error}</ErrorNote>}

      <Labelled
        label={allowRange ? "Book or series name" : "Book name"}
        hint="Only this is required — publisher and prices can wait."
      >
        <input className="field mt-1" value={form.name} onChange={set("name")} autoFocus required />
      </Labelled>

      {allowRange && (
        <Labelled label="Range" hint="Add a whole series at once — one book per step.">
          <select
            className="field mt-1"
            value={family}
            onChange={(e) => pickFamily(e.target.value as RangeFamily)}
          >
            {RANGE_FAMILIES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          {units.length > 0 && (
            <div className="mt-2 flex items-center gap-2">
              <select
                className="field"
                aria-label="From"
                value={lo}
                onChange={(e) => setFrom(Number(e.target.value))}
              >
                {units.map((u, i) => (
                  <option key={u} value={i}>
                    {u}
                  </option>
                ))}
              </select>
              <span className="text-sm text-[var(--ink-3)]">to</span>
              <select
                className="field"
                aria-label="To"
                value={hi}
                onChange={(e) => setTo(Number(e.target.value))}
              >
                {units.map((u, i) => (
                  <option key={u} value={i}>
                    {u}
                  </option>
                ))}
              </select>
            </div>
          )}
        </Labelled>
      )}

      <Labelled label="Publisher (optional)">
        <input className="field mt-1" value={form.publisher} onChange={set("publisher")} placeholder="Oxford" />
      </Labelled>

      <div className="grid grid-cols-2 gap-3">
        <Labelled label="Cost price (optional)" hint="What you pay. Drives profit.">
          <input
            className="field figure mt-1"
            inputMode="decimal"
            type="number"
            min={0}
            value={form.costPrice}
            onChange={set("costPrice")}
            placeholder="0"
          />
        </Labelled>
        <Labelled label="Selling price (optional)">
          <input
            className="field figure mt-1"
            inputMode="decimal"
            type="number"
            min={0}
            value={form.sellingPrice}
            onChange={set("sellingPrice")}
            placeholder="0"
          />
        </Labelled>
      </div>

      {span.length > 0 && baseName ? (
        <p className="text-xs text-[var(--ink-3)]">
          Creates {names.length} books — {names[0]} … {names[names.length - 1]}. The price applies
          to all; edit any of them later.
        </p>
      ) : (
        <p className="text-xs text-[var(--ink-3)]">
          No stock count is kept — selling a book never changes anything here.
        </p>
      )}

      <div className="flex gap-2 pt-1">
        {onCancel && (
          <button type="button" className="btn btn-quiet flex-1" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button className="btn btn-ink flex-1" disabled={saving || !baseName}>
          {saving
            ? "Saving…"
            : span.length > 0
            ? `Save ${names.length} books`
            : "Save book"}
        </button>
      </div>
    </form>
  );
}
