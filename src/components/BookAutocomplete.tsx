"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, Search } from "lucide-react";
import { createBook, listBooks } from "@/lib/client";
import { formatMoney, type Book } from "@/lib/types";
import { spineColor } from "@/lib/spine";
import { Spine } from "@/components/ui";

/**
 * The fast way to put a book on an invoice: type its name. Matches on the shelf
 * appear as you type — pick one and it comes with its price. Type something
 * that isn't on the shelf and it's added to the shelf on the spot, so it's
 * there next time (publisher and cost can be filled in later on the Books tab).
 */
export default function BookAutocomplete({ onAdd }: { onAdd: (book: Book) => void }) {
  const [q, setQ] = useState("");
  const [matches, setMatches] = useState<Book[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const query = q.trim();
    const t = setTimeout(() => {
      if (!query) {
        setMatches([]);
        return;
      }
      listBooks(query)
        .then((books) => setMatches(books.slice(0, 8)))
        .catch(() => setMatches([]));
    }, query ? 180 : 0);
    return () => clearTimeout(t);
  }, [q]);

  // Close the dropdown when focus leaves the whole control.
  useEffect(() => {
    function onDown(e: PointerEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);

  const query = q.trim();
  const exact = matches.find((b) => b.name.trim().toLowerCase() === query.toLowerCase());
  const canCreate = query.length > 0 && !exact;

  function pick(book: Book) {
    onAdd(book);
    setQ("");
    setMatches([]);
    setOpen(false);
  }

  async function createAndPick() {
    if (!query || busy) return;
    setBusy(true);
    try {
      // If it's already on the shelf under this exact name, use that.
      if (exact) return pick(exact);
      const book = await createBook({ name: query });
      pick(book);
    } catch {
      // Leave the text so the user can retry; failing silently is worse.
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative mt-3" ref={boxRef}>
      <div className="relative">
        <Search
          size={16}
          className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[var(--ink-3)]"
        />
        <input
          className="field pl-9"
          placeholder="Add a book — type its name"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (matches[0] && !canCreate) pick(matches[0]);
              else void createAndPick();
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          aria-label="Add a book"
        />
      </div>

      {open && query.length > 0 && (
        <ul className="absolute z-40 mt-1 max-h-72 w-full overflow-y-auto rounded-xl border border-[var(--rule)] bg-[var(--card)] py-1 shadow-xl">
          {matches.map((b) => (
            <li key={b.id}>
              <button
                type="button"
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-[var(--sunken)]"
                onClick={() => pick(b)}
              >
                <Spine color={spineColor(b.publisher)} title={b.publisher} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{b.name}</span>
                  {b.publisher && (
                    <span className="block truncate text-xs text-[var(--ink-3)]">{b.publisher}</span>
                  )}
                </span>
                {b.sellingPrice > 0 && (
                  <span className="figure shrink-0 text-sm">{formatMoney(b.sellingPrice)}</span>
                )}
              </button>
            </li>
          ))}

          {canCreate && (
            <li>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[var(--gold)] hover:bg-[var(--sunken)]"
                onClick={createAndPick}
                disabled={busy}
              >
                <Plus size={16} className="shrink-0" />
                <span className="text-sm font-medium">
                  {busy ? "Adding…" : <>Add &ldquo;{query}&rdquo; as a new book</>}
                </span>
              </button>
            </li>
          )}

          {matches.length === 0 && !canCreate && (
            <li className="px-3 py-2 text-sm text-[var(--ink-3)]">Keep typing…</li>
          )}
        </ul>
      )}
    </div>
  );
}
