"use client";

import { useCallback, useEffect, useState } from "react";
import { BookPlus, Pencil, Search } from "lucide-react";
import Sheet from "@/components/Sheet";
import { NewBookForm } from "@/components/BookPicker";
import { archiveBook, deleteBook, listBooks, updateBook } from "@/lib/client";
import { formatMoney, type Book } from "@/lib/types";
import { spineColor } from "@/lib/spine";
import { Empty, ErrorNote, Labelled, Loading, PageHeader, Spine } from "@/components/ui";

export default function BooksView() {
  const [q, setQ] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [books, setBooks] = useState<Book[] | null>(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Book | null>(null);

  const load = useCallback(() => {
    setError("");
    listBooks(q, showArchived)
      .then(setBooks)
      .catch((e: Error) => setError(e.message));
  }, [q, showArchived]);

  useEffect(() => {
    const t = setTimeout(load, q ? 220 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  const visible = showArchived ? books : (books || []).filter((b) => !b.archived);

  return (
    <main>
      <PageHeader
        title="Books"
        subtitle="Names and prices only — no stock is counted, so selling never changes anything here."
      />

      <div className="no-print sticky top-0 z-30 space-y-2 border-b border-[var(--rule)] bg-[var(--paper)]/95 px-4 pb-3 backdrop-blur">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search
              size={16}
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[var(--ink-3)]"
            />
            <input
              className="field pl-9"
              placeholder="Title, publisher or subject"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search books"
            />
          </div>
          <button className="btn btn-ink px-3" onClick={() => setAdding(true)} aria-label="Add book">
            <BookPlus size={18} />
          </button>
        </div>
        <label className="flex items-center gap-2 text-xs text-[var(--ink-2)]">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          Show archived books
        </label>
      </div>

      {error && (
        <div className="px-4 pt-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
      {!books && !error && <Loading label="Loading the shelf" />}

      {books && visible!.length > 0 && (
        <ul className="ruled">
          {visible!.map((b) => {
            const margin = b.sellingPrice > 0
              ? ((b.sellingPrice - b.costPrice) / b.sellingPrice) * 100
              : 0;
            return (
              <li key={b.id} className="flex items-stretch gap-3 px-4 py-3">
                <Spine color={spineColor(b.publisher)} title={b.publisher || "No publisher"} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`truncate font-medium ${b.archived ? "text-[var(--ink-3)] line-through" : ""}`}>
                      {b.shortName}
                    </span>
                    {b.archived && <span className="pill pill-draft">Archived</span>}
                  </div>
                  {b.fullName && b.fullName !== b.shortName && (
                    <p className="truncate text-xs text-[var(--ink-3)]">{b.fullName}</p>
                  )}
                  <p className="mt-0.5 text-xs text-[var(--ink-2)]">
                    {[b.publisher, b.category].filter(Boolean).join(" · ") || "No publisher recorded"}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <div className="figure text-sm font-semibold">{formatMoney(b.sellingPrice)}</div>
                  <div className="figure text-xs text-[var(--ink-3)]">
                    cost {formatMoney(b.costPrice)}
                  </div>
                  <div
                    className="figure text-xs"
                    style={{ color: margin > 0 ? "var(--credit)" : "var(--ink-3)" }}
                  >
                    {margin > 0 ? `${margin.toFixed(0)}% margin` : "—"}
                  </div>
                </div>
                <button
                  aria-label={`Edit ${b.shortName}`}
                  className="self-center rounded-lg p-1.5 text-[var(--ink-3)] hover:bg-[var(--sunken)] hover:text-[var(--ink)]"
                  onClick={() => setEditing(b)}
                >
                  <Pencil size={16} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {books && visible!.length === 0 && (
        <div className="px-4 py-6">
          <Empty
            title={q ? "No book matches" : "The shelf is empty"}
            hint={
              q
                ? "Try the publisher name, or just part of the title."
                : "Add the books you sell once. After that, an invoice is a few taps."
            }
            action={
              <button className="btn btn-ink" onClick={() => setAdding(true)}>
                <BookPlus size={17} /> Add a book
              </button>
            }
          />
        </div>
      )}

      <Sheet open={adding} title="Add a book" onClose={() => setAdding(false)}>
        <NewBookForm
          onCancel={() => setAdding(false)}
          onCreated={() => {
            setAdding(false);
            load();
          }}
        />
      </Sheet>

      <Sheet open={!!editing} title="Edit book" onClose={() => setEditing(null)}>
        {editing && (
          <EditBookForm
            book={editing}
            onDone={() => {
              setEditing(null);
              load();
            }}
          />
        )}
      </Sheet>
    </main>
  );
}

function EditBookForm({ book, onDone }: { book: Book; onDone: () => void }) {
  const [form, setForm] = useState({
    shortName: book.shortName,
    fullName: book.fullName,
    publisher: book.publisher,
    category: book.category,
    costPrice: String(book.costPrice),
    sellingPrice: String(book.sellingPrice),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function run(fn: () => Promise<unknown>) {
    setSaving(true);
    setError("");
    try {
      await fn();
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() =>
          updateBook(book.id, {
            shortName: form.shortName.trim(),
            fullName: form.fullName.trim(),
            publisher: form.publisher.trim(),
            category: form.category.trim(),
            costPrice: Number(form.costPrice) || 0,
            sellingPrice: Number(form.sellingPrice) || 0,
          })
        );
      }}
    >
      {error && <ErrorNote>{error}</ErrorNote>}

      <Labelled label="Short name" hint="What prints on the invoice.">
        <input className="field mt-1" value={form.shortName} onChange={set("shortName")} required />
      </Labelled>
      <Labelled label="Full title">
        <input className="field mt-1" value={form.fullName} onChange={set("fullName")} />
      </Labelled>
      <div className="grid grid-cols-2 gap-3">
        <Labelled label="Publisher">
          <input className="field mt-1" value={form.publisher} onChange={set("publisher")} />
        </Labelled>
        <Labelled label="Subject">
          <input className="field mt-1" value={form.category} onChange={set("category")} />
        </Labelled>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Labelled label="Cost price">
          <input className="field figure mt-1" type="number" min={0} value={form.costPrice} onChange={set("costPrice")} />
        </Labelled>
        <Labelled label="Selling price">
          <input className="field figure mt-1" type="number" min={0} value={form.sellingPrice} onChange={set("sellingPrice")} />
        </Labelled>
      </div>

      <p className="text-xs text-[var(--ink-3)]">
        Changing a price here only affects future invoices. Past invoices keep the price they were
        written at.
      </p>

      <button className="btn btn-ink w-full" disabled={saving}>
        {saving ? "Saving…" : "Save changes"}
      </button>

      <div className="flex gap-2 border-t border-[var(--rule)] pt-3">
        <button
          type="button"
          className="btn btn-quiet flex-1"
          disabled={saving}
          onClick={() =>
            void run(() =>
              book.archived ? updateBook(book.id, { archived: false }) : archiveBook(book.id)
            )
          }
        >
          {book.archived ? "Put back on the shelf" : "Archive"}
        </button>
        <button
          type="button"
          className="btn btn-danger flex-1"
          disabled={saving}
          onClick={() => void run(() => deleteBook(book.id))}
        >
          Delete
        </button>
      </div>
      <p className="text-xs text-[var(--ink-3)]">
        Archiving hides it from the picker but keeps its sales history. Deleting is refused if the
        book appears on any invoice.
      </p>
    </form>
  );
}
