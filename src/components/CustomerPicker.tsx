"use client";

import { useEffect, useState } from "react";
import { Search, UserPlus } from "lucide-react";
import Sheet from "@/components/Sheet";
import { createCustomer, listCustomers } from "@/lib/client";
import type { Customer } from "@/lib/types";
import { ErrorNote, Labelled } from "@/components/ui";

// Mounted only while open (see the callers), so its state resets on close
// without an effect to do it.
export default function CustomerPicker({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (c: Customer) => void;
}) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Customer[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const t = setTimeout(() => {
      setError("");
      listCustomers(q)
        .then(setRows)
        .catch((e: Error) => setError(e.message));
    }, q ? 200 : 0);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <Sheet open title={adding ? "Add a school" : "Choose a school"} onClose={onClose}>
      {error && <ErrorNote>{error}</ErrorNote>}

      {adding ? (
        <NewCustomerForm
          initialName={q}
          onCancel={() => setAdding(false)}
          onCreated={(c) => {
            onPick(c);
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
              placeholder="School or bookshop name"
              value={q}
              autoFocus
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search customers"
            />
          </div>

          <button className="btn btn-quiet mt-2 w-full" onClick={() => setAdding(true)}>
            <UserPlus size={17} /> Add a new school
          </button>

          <ul className="ruled mt-3">
            {(rows || []).map((c) => (
              <li key={c.id}>
                <button
                  className="w-full py-2.5 text-left"
                  onClick={() => {
                    onPick(c);
                    onClose();
                  }}
                >
                  <span className="block truncate font-medium">{c.name}</span>
                  <span className="block truncate text-xs text-[var(--ink-3)]">
                    {[c.phone, c.address].filter(Boolean).join(" · ") || "No contact details"}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          {rows && rows.length === 0 && (
            <p className="py-6 text-center text-sm text-[var(--ink-3)]">
              {q ? `No school matches “${q}”.` : "No schools on file yet."} Add one above.
            </p>
          )}
        </>
      )}
    </Sheet>
  );
}

export function NewCustomerForm({
  initialName = "",
  onCreated,
  onCancel,
}: {
  initialName?: string;
  onCreated: (c: Customer) => void;
  onCancel?: () => void;
}) {
  const [form, setForm] = useState({ name: initialName, phone: "", address: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      onCreated(
        await createCustomer({
          name: form.name.trim(),
          phone: form.phone.trim(),
          address: form.address.trim(),
          notes: form.notes,
        })
      );
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {error && <ErrorNote>{error}</ErrorNote>}

      <Labelled label="School / customer name">
        <input
          className="field mt-1"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="ABC International School"
          autoFocus
          required
        />
      </Labelled>

      <Labelled label="Phone">
        <input
          className="field mt-1"
          type="tel"
          inputMode="tel"
          value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
          placeholder="0801 234 5678"
        />
      </Labelled>

      <Labelled label="Address">
        <input
          className="field mt-1"
          value={form.address}
          onChange={(e) => setForm({ ...form, address: e.target.value })}
          placeholder="12 Herbert Macaulay Way, Yaba"
        />
      </Labelled>

      <Labelled label="Notes">
        <textarea
          className="field mt-1"
          rows={2}
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          placeholder="Pays at end of term. Ask for Mrs Bello."
        />
      </Labelled>

      <div className="flex gap-2 pt-1">
        {onCancel && (
          <button type="button" className="btn btn-quiet flex-1" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button className="btn btn-ink flex-1" disabled={saving || !form.name.trim()}>
          {saving ? "Saving…" : "Save school"}
        </button>
      </div>
    </form>
  );
}
