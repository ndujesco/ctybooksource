"use client";

import { useCallback, useEffect, useState } from "react";
import { RotateCcw, Trash2 } from "lucide-react";
import {
  deleteInvoiceForever,
  emptyTrash,
  listTrash,
  restoreInvoice,
} from "@/lib/client";
import { formatMoney, invoiceNumberLabel, type Invoice } from "@/lib/types";
import { formatDate } from "@/lib/datetime";
import { Empty, ErrorNote, Loading, PageHeader } from "@/components/ui";

export default function TrashView() {
  const [rows, setRows] = useState<Invoice[] | null>(null);
  const [error, setError] = useState("");
  const [confirmEmpty, setConfirmEmpty] = useState(false);

  const load = useCallback(() => {
    listTrash()
      .then(setRows)
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(load, [load]);

  async function act(fn: () => Promise<unknown>) {
    try {
      await fn();
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <main>
      <PageHeader
        title="Deleted invoices"
        subtitle="Nothing here counts towards any total."
        back="/invoices"
        action={
          rows && rows.length > 0 ? (
            <button className="btn btn-danger mt-1" onClick={() => setConfirmEmpty(true)}>
              Empty bin
            </button>
          ) : undefined
        }
      />

      {error && (
        <div className="px-4 pb-3">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
      {!rows && !error && <Loading label="Loading the bin" />}

      {rows && rows.length === 0 && (
        <div className="px-4 py-6">
          <Empty title="The bin is empty" hint="Deleted invoices land here and can be restored." />
        </div>
      )}

      {rows && rows.length > 0 && (
        <ul className="ruled">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <span className="block truncate font-medium">
                  {r.customerName || "No school"}
                </span>
                <span className="figure block text-xs text-[var(--ink-3)]">
                  {invoiceNumberLabel(r.number)} · {formatDate(r.date)} ·{" "}
                  {formatMoney(r.totals.total)}
                </span>
              </div>
              <button
                className="btn btn-quiet px-2.5"
                aria-label={`Restore ${invoiceNumberLabel(r.number)}`}
                onClick={() => act(() => restoreInvoice(r.id))}
              >
                <RotateCcw size={16} />
              </button>
              <button
                className="btn btn-danger px-2.5"
                aria-label={`Delete ${invoiceNumberLabel(r.number)} forever`}
                onClick={() => act(() => deleteInvoiceForever(r.id))}
              >
                <Trash2 size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {confirmEmpty && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
          <button
            className="fade-in absolute inset-0 bg-[rgba(22,34,58,0.4)]"
            aria-label="Cancel"
            onClick={() => setConfirmEmpty(false)}
          />
          <div className="sheet-in card relative w-full max-w-sm p-5" role="dialog" aria-modal="true">
            <p className="display text-lg">Empty the bin?</p>
            <p className="mt-1 text-sm text-[var(--ink-2)]">
              {rows?.length} {rows?.length === 1 ? "invoice" : "invoices"} will be gone for good.
              This can&rsquo;t be undone.
            </p>
            <div className="mt-4 flex gap-2">
              <button className="btn btn-quiet flex-1" onClick={() => setConfirmEmpty(false)}>
                Keep them
              </button>
              <button
                className="btn btn-danger flex-1"
                onClick={() => {
                  setConfirmEmpty(false);
                  void act(() => emptyTrash());
                }}
              >
                Empty bin
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
