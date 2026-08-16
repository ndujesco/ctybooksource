"use client";

import { useEffect, useState } from "react";
import { BookPlus, Search } from "lucide-react";
import Sheet from "@/components/Sheet";
import { createBook, listBooks } from "@/lib/client";
import { formatMoney, type Book } from "@/lib/types";
import { spineColor } from "@/lib/spine";
import { ErrorNote, Labelled, Spine } from "@/components/ui";

/**
 * Pick a book off the shelf. Short name is what you search and what lands on
 * the invoice; the full title rides along for when a school wants it.
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
              placeholder="Short name, title or publisher"
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
                    <span className="block truncate font-medium">{b.shortName}</span>
                    <span className="block truncate text-xs text-[var(--ink-3)]">
                      {b.fullName !== b.shortName ? b.fullName : b.publisher || "No publisher"}
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

export function NewBookForm({
  initialName = "",
  onCreated,
  onCancel,
}: {
  initialName?: string;
  onCreated: (b: Book) => void;
  onCancel?: () => void;
}) {
  const [form, setForm] = useState({
    shortName: initialName,
    fullName: "",
    publisher: "",
    category: "",
    costPrice: "",
    sellingPrice: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const book = await createBook({
        shortName: form.shortName.trim(),
        fullName: form.fullName.trim(),
        publisher: form.publisher.trim(),
        category: form.category.trim(),
        costPrice: Number(form.costPrice) || 0,
        sellingPrice: Number(form.sellingPrice) || 0,
      });
      onCreated(book);
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {error && <ErrorNote>{error}</ErrorNote>}

      <Labelled label="Short name" hint="What prints on the invoice. Keep it tight — “Oxford Maths 5”.">
        <input className="field mt-1" value={form.shortName} onChange={set("shortName")} autoFocus required />
      </Labelled>

      <Labelled label="Full title" hint="The official title, for when a school asks for it.">
        <input
          className="field mt-1"
          value={form.fullName}
          onChange={set("fullName")}
          placeholder="Oxford Mathematics for Primary Schools Book 5"
        />
      </Labelled>

      <div className="grid grid-cols-2 gap-3">
        <Labelled label="Publisher">
          <input className="field mt-1" value={form.publisher} onChange={set("publisher")} placeholder="Oxford" />
        </Labelled>
        <Labelled label="Subject">
          <input className="field mt-1" value={form.category} onChange={set("category")} placeholder="Mathematics" />
        </Labelled>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Labelled label="Cost price" hint="What you pay. Drives profit.">
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
        <Labelled label="Selling price">
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

      <p className="text-xs text-[var(--ink-3)]">
        No stock count is kept — selling a book never changes anything here.
      </p>

      <div className="flex gap-2 pt-1">
        {onCancel && (
          <button type="button" className="btn btn-quiet flex-1" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button className="btn btn-ink flex-1" disabled={saving || !form.shortName.trim()}>
          {saving ? "Saving…" : "Save book"}
        </button>
      </div>
    </form>
  );
}
