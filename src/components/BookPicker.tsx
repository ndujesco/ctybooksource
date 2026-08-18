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

/* A book series can span a whole set of classes. Picking a range creates one
   book per class, e.g. "Understanding Maths" → "Understanding Maths Primary 1"
   … "Primary 6", all sharing the price you typed. */
const CLASS_RANGES: { value: string; label: string; classes: string[] }[] = [
  { value: "", label: "Just this book", classes: [] },
  { value: "nursery", label: "Nursery 1–3", classes: ["Nursery 1", "Nursery 2", "Nursery 3"] },
  {
    value: "primary",
    label: "Primary 1–6",
    classes: ["Primary 1", "Primary 2", "Primary 3", "Primary 4", "Primary 5", "Primary 6"],
  },
  { value: "jss", label: "JSS 1–3", classes: ["JSS 1", "JSS 2", "JSS 3"] },
  { value: "sss", label: "SSS 1–3", classes: ["SSS 1", "SSS 2", "SSS 3"] },
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
  const [range, setRange] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const classes = CLASS_RANGES.find((r) => r.value === range)?.classes ?? [];
  const baseName = form.name.trim();
  // The exact list of book names that will be created.
  const names = classes.length ? classes.map((c) => `${baseName} ${c}`) : [baseName];

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
        <Labelled label="Classes" hint="Add the whole series at once — one book per class.">
          <select
            className="field mt-1"
            value={range}
            onChange={(e) => setRange(e.target.value)}
          >
            {CLASS_RANGES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
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

      {classes.length > 0 && baseName ? (
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
            : classes.length > 0
            ? `Save ${names.length} books`
            : "Save book"}
        </button>
      </div>
    </form>
  );
}
