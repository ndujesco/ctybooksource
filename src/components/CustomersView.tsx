"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Search, UserPlus } from "lucide-react";
import Sheet from "@/components/Sheet";
import { NewCustomerForm } from "@/components/CustomerPicker";
import { listCustomers } from "@/lib/client";
import type { Customer } from "@/lib/types";
import { Empty, ErrorNote, Loading, PageHeader } from "@/components/ui";

export default function CustomersView() {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Customer[] | null>(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    setError("");
    listCustomers(q)
      .then(setRows)
      .catch((e: Error) => setError(e.message));
  }, [q]);

  useEffect(() => {
    const t = setTimeout(load, q ? 220 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  return (
    <main>
      <PageHeader title="Schools" subtitle="Open one to see everything they've bought and everything they owe." />

      <div className="no-print sticky top-0 z-30 border-b border-[var(--rule)] bg-[var(--paper)]/95 px-4 pb-3 backdrop-blur">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search
              size={16}
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[var(--ink-3)]"
            />
            <input
              className="field pl-9"
              placeholder="School, bookshop or phone"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search schools"
            />
          </div>
          <button className="btn btn-ink px-3" onClick={() => setAdding(true)} aria-label="Add school">
            <UserPlus size={18} />
          </button>
        </div>
      </div>

      {error && (
        <div className="px-4 pt-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
      {!rows && !error && <Loading label="Loading schools" />}

      {rows && rows.length > 0 && (
        <ul className="ruled">
          {rows.map((c) => (
            <li key={c.id}>
              <Link href={`/customers/${c.id}`} className="block px-4 py-3 hover:bg-[var(--sunken)]">
                <span className="block truncate font-medium">{c.name}</span>
                <span className="block truncate text-xs text-[var(--ink-3)]">
                  {[c.phone, c.address].filter(Boolean).join(" · ") || "No contact details"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {rows && rows.length === 0 && (
        <div className="px-4 py-6">
          <Empty
            title={q ? "No school matches" : "No schools on file"}
            hint={
              q
                ? "Try part of the name, or the phone number."
                : "Add a school once and every invoice you write for them rolls up into one record."
            }
            action={
              <button className="btn btn-ink" onClick={() => setAdding(true)}>
                <UserPlus size={17} /> Add a school
              </button>
            }
          />
        </div>
      )}

      <Sheet open={adding} title="Add a school" onClose={() => setAdding(false)}>
        <NewCustomerForm
          onCancel={() => setAdding(false)}
          onCreated={() => {
            setAdding(false);
            load();
          }}
        />
      </Sheet>
    </main>
  );
}
