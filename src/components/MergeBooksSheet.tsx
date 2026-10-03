"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Loader2, Search, X } from "lucide-react";
import Sheet from "@/components/Sheet";
import { Empty, ErrorNote, Loading, Spine } from "@/components/ui";
import {
  listBooks,
  listDuplicates,
  mergeBooks,
  type DuplicateGroup,
  type MergeResult,
} from "@/lib/client";
import { formatMoney, type Book } from "@/lib/types";
import { spineColor } from "@/lib/spine";

/* ---------------------------------------------------------------------------
   Joining duplicate books.

   The shelf has the same title on it more than once — "Bond Non-Verbal 6-7"
   beside "Bond Non-Verbal. 6-7" — and while they sit apart, each one shows half
   the copies actually sold. Joining them repoints every invoice line onto the
   record that stays, so the sales arrive with it, and only then removes the
   other. Nothing is lost; the figures simply stop being split in two.

   Two ways in, because duplicates come in two kinds:
   · **Found** — the same title spelt differently. Detected automatically.
   · **By hand** — the same book under a different name entirely ("Mental
     Arithmetic 3" is S/Sims Mental Arithmetic 3). Only a person knows that, so
     there is a plain search-and-pick for it.
   ------------------------------------------------------------------------ */

type Mode = "found" | "manual";

export default function MergeBooksSheet({
  onClose,
  onMerged,
}: {
  onClose: () => void;
  onMerged: () => void;
}) {
  const [mode, setMode] = useState<Mode>("found");
  const [groups, setGroups] = useState<DuplicateGroup[] | null>(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState<MergeResult[]>([]);

  const load = useCallback(() => {
    listDuplicates()
      .then((g) => {
        setGroups(g);
        setError("");
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(load, [load]);

  function recordMerge(result: MergeResult) {
    setDone((prev) => [result, ...prev]);
    onMerged();
    load();
  }

  return (
    <Sheet open title="Join duplicate books" onClose={onClose}>
      <p className="text-sm text-[var(--ink-2)]">
        The copies sold under each duplicate move onto the record you keep, and only then is the
        duplicate removed. Past invoices keep the prices they were written at, so no profit figure
        changes — the sales just stop being split across two names.
      </p>

      <div className="segment mt-3" role="group" aria-label="How to find duplicates">
        <button type="button" data-on={mode === "found"} onClick={() => setMode("found")}>
          Found {groups ? `(${groups.length})` : ""}
        </button>
        <button type="button" data-on={mode === "manual"} onClick={() => setMode("manual")}>
          Pick by hand
        </button>
      </div>

      {error && (
        <div className="mt-3">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      {done.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {done.map((d, i) => (
            <li
              key={`${d.kept.id}-${i}`}
              className="rounded-lg border px-3 py-2 text-xs"
              style={{
                background: "var(--credit-soft)",
                borderColor: "rgba(21,127,78,0.25)",
                color: "var(--credit)",
              }}
            >
              <span className="font-semibold">{d.kept.name}</span> now holds it all —{" "}
              {d.removed} {d.removed === 1 ? "record" : "records"} joined in,{" "}
              {d.linesRepointed} invoice {d.linesRepointed === 1 ? "line" : "lines"} moved,{" "}
              {d.qtyMoved} {d.qtyMoved === 1 ? "copy" : "copies"} now counted here
              {d.pricesMoved > 0
                ? `, ${d.pricesMoved} school ${d.pricesMoved === 1 ? "price" : "prices"} carried over`
                : ""}
              {d.filledIn.length > 0 ? `, and it picked up a ${d.filledIn.join(", ")}` : ""}.
            </li>
          ))}
        </ul>
      )}

      {mode === "found" ? (
        <FoundGroups groups={groups} onMerged={recordMerge} />
      ) : (
        <ManualMerge onMerged={recordMerge} />
      )}
    </Sheet>
  );
}

/* -- The ones the app spotted itself -------------------------------------- */

function FoundGroups({
  groups,
  onMerged,
}: {
  groups: DuplicateGroup[] | null;
  onMerged: (r: MergeResult) => void;
}) {
  if (!groups) return <Loading label="Reading the shelf" />;
  if (!groups.length) {
    return (
      <div className="mt-4">
        <Empty
          title="No duplicates left"
          hint="Nothing on the shelf is the same title written two ways. A book filed under a different name altogether won't show up here — join those under “Pick by hand”."
        />
      </div>
    );
  }

  return (
    <ul className="mt-3 space-y-3">
      {groups.map((g) => (
        <GroupCard key={g.key} group={g} onMerged={onMerged} />
      ))}
    </ul>
  );
}

function GroupCard({
  group,
  onMerged,
}: {
  group: DuplicateGroup;
  onMerged: (r: MergeResult) => void;
}) {
  const [keepId, setKeepId] = useState(group.suggestedKeepId);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const mergeIds = group.books
    .map((b) => b.id)
    .filter((id) => id !== keepId && !skipped.has(id));

  async function join() {
    if (!mergeIds.length) return;
    setBusy(true);
    setError("");
    try {
      onMerged(await mergeBooks(keepId, mergeIds));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const movingQty = group.books
    .filter((b) => mergeIds.includes(b.id))
    .reduce((s, b) => s + b.qty, 0);

  return (
    <li className="card p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 font-medium">{group.title}</span>
        <span className="figure shrink-0 text-xs text-[var(--ink-3)]">
          {group.books.length} records · {group.qty} copies
        </span>
      </div>

      <ul className="mt-2 space-y-1">
        {group.books.map((b) => {
          const keeping = b.id === keepId;
          const leftOut = skipped.has(b.id);
          return (
            <li
              key={b.id}
              className="flex items-center gap-2 rounded-lg px-2 py-1.5"
              style={{ background: keeping ? "var(--gold-soft)" : "transparent" }}
            >
              <input
                type="radio"
                name={`keep-${group.key}`}
                checked={keeping}
                onChange={() => setKeepId(b.id)}
                aria-label={`Keep ${b.name}`}
              />
              <Spine color={spineColor(b.publisher)} title={b.publisher} />
              <span className="min-w-0 flex-1">
                <span
                  className="block truncate text-sm"
                  style={{ textDecoration: leftOut && !keeping ? "line-through" : undefined }}
                >
                  {b.name}
                </span>
                <span className="block truncate text-xs text-[var(--ink-3)]">
                  {b.publisher || "No publisher recorded"}
                  {b.sellingPrice > 0 ? ` · ${formatMoney(b.sellingPrice)}` : ""}
                  {b.qty > 0 ? ` · ${b.qty} sold` : " · never sold"}
                </span>
              </span>
              {keeping ? (
                <span className="pill pill-paid shrink-0">Keep</span>
              ) : (
                <button
                  type="button"
                  className="shrink-0 text-xs text-[var(--ink-3)] underline underline-offset-2"
                  onClick={() =>
                    setSkipped((prev) => {
                      const next = new Set(prev);
                      if (next.has(b.id)) next.delete(b.id);
                      else next.add(b.id);
                      return next;
                    })
                  }
                >
                  {leftOut ? "put back" : "leave it"}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {error && (
        <div className="mt-2">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      <button className="btn btn-ink mt-2 w-full" onClick={join} disabled={busy || !mergeIds.length}>
        {busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
        {busy
          ? "Joining…"
          : mergeIds.length
          ? `Join ${mergeIds.length} in${movingQty > 0 ? ` · ${movingQty} copies move` : ""}`
          : "Nothing selected to join"}
      </button>
    </li>
  );
}

/* -- The ones only he can see --------------------------------------------- */

function ManualMerge({ onMerged }: { onMerged: (r: MergeResult) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Book[]>([]);
  const [picked, setPicked] = useState<Book[]>([]);
  const [keepId, setKeepId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const query = q.trim();
  useEffect(() => {
    if (!query) return;
    const t = setTimeout(() => {
      listBooks(query)
        .then((b) => setResults(b.slice(0, 20)))
        .catch(() => setResults([]));
    }, 200);
    return () => clearTimeout(t);
  }, [query]);
  // An empty box shows nothing, rather than the results of the search before it.
  const shown = query ? results : [];

  const pickedIds = useMemo(() => new Set(picked.map((b) => b.id)), [picked]);

  function add(book: Book) {
    if (pickedIds.has(book.id)) return;
    setPicked((prev) => [...prev, book]);
    // Default to keeping the record that knows its publisher — the hand-typed
    // duplicates are the ones missing it.
    setKeepId((cur) => cur || (book.publisher ? book.id : ""));
  }

  function drop(id: string) {
    setPicked((prev) => prev.filter((b) => b.id !== id));
    setKeepId((cur) => (cur === id ? "" : cur));
  }

  const keep = keepId || picked.find((b) => b.publisher)?.id || picked[0]?.id || "";
  const mergeIds = picked.map((b) => b.id).filter((id) => id !== keep);

  async function join() {
    if (!keep || !mergeIds.length) return;
    setBusy(true);
    setError("");
    try {
      onMerged(await mergeBooks(keep, mergeIds));
      setPicked([]);
      setKeepId("");
      setQ("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3">
      <p className="text-sm text-[var(--ink-2)]">
        Search for the books that are really the same one, add them all, then say which record
        stays. Use this for a book filed under another name — &ldquo;Mental Arithmetic 3&rdquo; that
        belongs with &ldquo;S/Sims Mental Arithmetic 3&rdquo;.
      </p>

      {picked.length > 0 && (
        <ul className="mt-3 space-y-1">
          {picked.map((b) => (
            <li
              key={b.id}
              className="flex items-center gap-2 rounded-lg px-2 py-1.5"
              style={{ background: b.id === keep ? "var(--gold-soft)" : "var(--sunken)" }}
            >
              <input
                type="radio"
                name="manual-keep"
                checked={b.id === keep}
                onChange={() => setKeepId(b.id)}
                aria-label={`Keep ${b.name}`}
              />
              <Spine color={spineColor(b.publisher)} title={b.publisher} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{b.name}</span>
                <span className="block truncate text-xs text-[var(--ink-3)]">
                  {b.publisher || "No publisher recorded"}
                </span>
              </span>
              {b.id === keep && <span className="pill pill-paid shrink-0">Keep</span>}
              <button
                type="button"
                aria-label={`Take ${b.name} out`}
                className="shrink-0 rounded-lg p-1 text-[var(--ink-3)] hover:text-[var(--debit)]"
                onClick={() => drop(b.id)}
              >
                <X size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="relative mt-3">
        <Search
          size={16}
          className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[var(--ink-3)]"
        />
        <input
          className="field pl-9"
          placeholder="Search the shelf"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search for books to join"
        />
      </div>

      {shown.length > 0 && (
        <ul className="ruled mt-2 max-h-72 overflow-y-auto rounded-xl border border-[var(--rule)]">
          {shown.map((b) => (
            <li key={b.id}>
              <button
                type="button"
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-[var(--sunken)] disabled:opacity-40"
                onClick={() => add(b)}
                disabled={pickedIds.has(b.id)}
              >
                <Spine color={spineColor(b.publisher)} title={b.publisher} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{b.name}</span>
                  <span className="block truncate text-xs text-[var(--ink-3)]">
                    {b.publisher || "No publisher recorded"}
                  </span>
                </span>
                {pickedIds.has(b.id) && (
                  <span className="shrink-0 text-xs text-[var(--ink-3)]">added</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <div className="mt-2">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      <button
        className="btn btn-ink mt-3 w-full"
        onClick={join}
        disabled={busy || picked.length < 2}
      >
        {busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
        {picked.length < 2
          ? "Add at least two books"
          : `Join ${mergeIds.length} into “${picked.find((b) => b.id === keep)?.name ?? ""}”`}
      </button>
    </div>
  );
}
