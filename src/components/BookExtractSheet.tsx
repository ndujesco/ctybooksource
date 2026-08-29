"use client";

import { useState } from "react";
import { FileText, Loader2, Sparkles, Upload, X } from "lucide-react";
import Sheet from "@/components/Sheet";
import { ErrorNote, Spine } from "@/components/ui";
import { createBook, extractBooks, type ExtractedCatalogueItem } from "@/lib/client";
import { formatMoney } from "@/lib/types";
import { spineColor } from "@/lib/spine";

/** A parsed catalogue entry once it's editable in the review step. */
type Draft = {
  key: string;
  name: string;
  publisher: string;
  costPrice: string;
  sellingPrice: string;
  existing: ExtractedCatalogueItem["existing"];
};

function toDrafts(items: ExtractedCatalogueItem[]): Draft[] {
  return items.map((it, i) => ({
    key: `d${i}`,
    name: it.name,
    publisher: it.publisher,
    costPrice: it.costPrice ? String(it.costPrice) : "",
    sellingPrice: it.sellingPrice ? String(it.sellingPrice) : "",
    existing: it.existing,
  }));
}

/**
 * Describe a book or a whole series in plain language — "Bond from 5-6 to
 * 9-10, 1300 naira each" — and review the shelf entries it turns into before
 * anything is saved.
 */
export default function BookExtractSheet({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded: () => void;
}) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");

  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [saving, setSaving] = useState(false);

  async function read() {
    setReading(true);
    setError("");
    try {
      const extraction = await extractBooks({ text, files });
      setDrafts(toDrafts(extraction.items));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setReading(false);
    }
  }

  function patch(key: string, next: Partial<Draft>) {
    setDrafts((prev) => prev?.map((d) => (d.key === key ? { ...d, ...next } : d)) ?? null);
  }

  async function save() {
    if (!drafts?.length) return;
    setSaving(true);
    setError("");
    try {
      const remaining = drafts.filter((d) => d.name.trim());
      for (const d of remaining) {
        await createBook({
          name: d.name.trim(),
          publisher: d.publisher.trim(),
          costPrice: Number(d.costPrice) || 0,
          sellingPrice: Number(d.sellingPrice) || 0,
        });
      }
      onAdded();
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  /* -- Review step ------------------------------------------------------- */

  if (drafts) {
    return (
      <Sheet
        open
        title={`${drafts.length} ${drafts.length === 1 ? "book" : "books"} found`}
        onClose={onClose}
        footer={
          <button className="btn btn-ink w-full" onClick={save} disabled={saving || !drafts.length}>
            {saving ? <Loader2 size={17} className="animate-spin" /> : null}
            {saving
              ? "Adding…"
              : `Add ${drafts.length} ${drafts.length === 1 ? "book" : "books"} to the shelf`}
          </button>
        }
      >
        {error && <ErrorNote>{error}</ErrorNote>}

        {drafts.length === 0 ? (
          <p className="py-6 text-center text-sm text-[var(--ink-3)]">
            Nothing left to add — every line was removed.
          </p>
        ) : (
          <ul className="mt-1 space-y-2">
            {drafts.map((d) => (
              <li key={d.key} className="card flex gap-2.5 p-2.5">
                <Spine color={spineColor(d.publisher)} />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex items-start gap-2">
                    <input
                      className="field flex-1 py-1 text-sm font-medium"
                      value={d.name}
                      onChange={(e) => patch(d.key, { name: e.target.value })}
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

                  {d.existing && (
                    <p className="rounded-lg bg-[var(--sunken)] px-2.5 py-2 text-xs text-[var(--ink-2)]">
                      Looks like this is already on the shelf as{" "}
                      <span className="font-medium text-[var(--ink)]">{d.existing.name}</span>
                      {d.existing.sellingPrice > 0 ? ` · ${formatMoney(d.existing.sellingPrice)}` : ""}.
                      Remove this line above if you don&rsquo;t want a duplicate.
                    </p>
                  )}

                  <input
                    className="field py-1 text-sm"
                    placeholder="Publisher (optional)"
                    value={d.publisher}
                    onChange={(e) => patch(d.key, { publisher: e.target.value })}
                    aria-label="Publisher"
                  />

                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[var(--ink-3)]">Cost ₦</span>
                    <input
                      className="field figure min-w-0 flex-1 py-1 text-right text-sm"
                      type="number"
                      inputMode="decimal"
                      min={0}
                      placeholder="0"
                      value={d.costPrice}
                      onChange={(e) => patch(d.key, { costPrice: e.target.value })}
                      aria-label="Cost price"
                    />
                    <span className="text-xs text-[var(--ink-3)]">Sell ₦</span>
                    <input
                      className="field figure min-w-0 flex-1 py-1 text-right text-sm"
                      type="number"
                      inputMode="decimal"
                      min={0}
                      placeholder="0"
                      value={d.sellingPrice}
                      onChange={(e) => patch(d.key, { sellingPrice: e.target.value })}
                      aria-label="Selling price"
                    />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        {drafts.length > 0 && (
          <p className="mt-3 text-xs text-[var(--ink-3)]">
            A blank price is fine — set it any time from the Books tab.
          </p>
        )}
      </Sheet>
    );
  }

  /* -- Source step --------------------------------------------------------- */

  return (
    <Sheet
      open
      title="Add with AI"
      onClose={onClose}
      footer={
        <button
          className="btn btn-ink w-full"
          onClick={read}
          disabled={reading || (!files.length && !text.trim())}
        >
          {reading ? <Loader2 size={17} className="animate-spin" /> : <Sparkles size={17} />}
          {reading ? "Reading…" : "Read the description"}
        </button>
      }
    >
      <p className="flex items-start gap-2 text-sm text-[var(--ink-2)]">
        <Sparkles size={16} className="mt-0.5 shrink-0 text-[var(--gold)]" />
        Describe a book, a series, or a whole range — the price applies to every step. You&rsquo;ll
        review everything before it&rsquo;s saved.
      </p>

      <textarea
        className="field mt-3"
        rows={5}
        placeholder={
          "Bond from 5-6 to 9-10, 1300 naira each\nNew General Mathematics book 1 to 3 by Longman, cost 900 sell 1200\nMacmillan Basic Science JSS1-3, 1500"
        }
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setError("");
        }}
        aria-label="Describe the books"
        autoFocus
      />

      <div className="my-3 flex items-center gap-3">
        <span className="h-px flex-1 bg-[var(--rule)]" />
        <span className="text-xs text-[var(--ink-3)]">or add a photo of a price list</span>
        <span className="h-px flex-1 bg-[var(--rule)]" />
      </div>

      <label className="flex cursor-pointer flex-col items-center rounded-xl border border-dashed border-[var(--rule-strong)] px-4 py-6 text-center hover:border-[var(--gold)]">
        <Upload size={22} className="text-[var(--gold)]" />
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
            e.target.value = "";
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

      {error && (
        <div className="mt-3">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
    </Sheet>
  );
}
