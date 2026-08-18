"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Ban,
  Check,
  ChevronLeft,
  Plus,
  Share2,
  Trash2,
  X,
} from "lucide-react";
import BookAutocomplete from "@/components/BookAutocomplete";
import CustomerPicker from "@/components/CustomerPicker";
import ShareSheet from "@/components/ShareSheet";
import InvoiceDocument from "@/components/InvoiceDocument";
import { ErrorNote, Labelled, Loading, Money, Spine, StatusPill } from "@/components/ui";
import {
  clearLocal,
  getInvoice,
  loadLocal,
  saveInvoice,
  saveLocal,
  trashInvoice,
  type InvoicePatch,
} from "@/lib/client";
import {
  computeTotals,
  derivePayStatus,
  formatMoney,
  invoiceNumberLabel,
  lineTotal,
  PAYMENT_METHODS,
  round2,
  sumPayments,
  type Book,
  type Invoice,
  type Line,
  type Payment,
  type PaymentMethod,
} from "@/lib/types";
import { formatDate, today } from "@/lib/datetime";
import { spineColor } from "@/lib/spine";
import { useBusiness, useHeaderToggles } from "@/lib/use-settings";

const SAVE_DEBOUNCE = 700;

type Editable = {
  customerId: string | null;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  lines: Line[];
  date: string;
  discountPercent: number;
  payments: Payment[];
  notes: string;
};

export default function InvoiceEditor({ id }: { id: string }) {
  const router = useRouter();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [form, setForm] = useState<Editable | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");

  const [pickCustomer, setPickCustomer] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [addingPayment, setAddingPayment] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<Editable | null>(null);

  // The letterhead for the print-only copy of the document.
  const business = useBusiness();
  const toggles = useHeaderToggles();

  /* -- Load ------------------------------------------------------------- */

  useEffect(() => {
    getInvoice(id)
      .then((inv) => {
        if (!inv) {
          setMissing(true);
          return;
        }
        setInvoice(inv);
        const server: Editable = {
          customerId: inv.customerId,
          customerName: inv.customerName,
          customerPhone: inv.customerPhone,
          customerAddress: inv.customerAddress,
          lines: inv.lines,
          date: inv.date,
          discountPercent: inv.discountPercent,
          payments: inv.payments,
          notes: inv.notes,
        };
        // A local mirror newer than the server copy means the last debounced
        // save never landed — prefer whatever it holds.
        const local = loadLocal(id);
        const fresh = local && local.savedAt > new Date(inv.updatedAt).getTime();
        setForm(fresh ? { ...server, ...stripUndefined(local) } : server);
      })
      .catch((e: Error) => setError(e.message));
  }, [id]);

  /* -- Save ------------------------------------------------------------- */

  const flush = useCallback(
    async (data: Editable, keepalive = false) => {
      setSaveState("saving");
      const patch: InvoicePatch = { ...data };
      const saved = await saveInvoice(id, patch, { keepalive });
      if (saved) {
        setInvoice(saved);
        clearLocal(id);
        setSaveState("saved");
      } else {
        setSaveState("idle");
      }
    },
    [id]
  );

  const queue = useCallback(
    (next: Editable) => {
      latest.current = next;
      saveLocal(id, next);
      setSaveState("saving");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        void flush(next).catch(() => setSaveState("idle"));
      }, SAVE_DEBOUNCE);
    },
    [flush, id]
  );

  const update = useCallback(
    (patch: Partial<Editable>) => {
      setForm((prev) => {
        if (!prev) return prev;
        const next = { ...prev, ...patch };
        queue(next);
        return next;
      });
    },
    [queue]
  );

  // Leaving the page (backgrounding the tab, closing it) flushes immediately.
  useEffect(() => {
    const onLeave = () => {
      if (!latest.current) return;
      if (timer.current) clearTimeout(timer.current);
      void flush(latest.current, true);
    };
    window.addEventListener("pagehide", onLeave);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") onLeave();
    });
    return () => {
      window.removeEventListener("pagehide", onLeave);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [flush]);

  /* -- Derived (recomputed locally so the screen never lags the keystroke) */

  const totals = useMemo(
    () => (form ? computeTotals(form.lines, form.discountPercent) : null),
    [form]
  );
  const paid = useMemo(() => (form ? sumPayments(form.payments) : 0), [form]);
  const balance = totals ? round2(totals.total - paid) : 0;

  /* -- Line actions ------------------------------------------------------ */

  function addBook(b: Book) {
    if (!form) return;
    const line: Line = {
      id: `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      bookId: b.id,
      name: b.name,
      publisher: b.publisher,
      category: b.category,
      qty: 1,
      unitPrice: b.sellingPrice,
      costPrice: b.costPrice,
    };
    update({ lines: [...form.lines, line] });
  }

  function patchLine(lineId: string, patch: Partial<Line>) {
    if (!form) return;
    update({ lines: form.lines.map((l) => (l.id === lineId ? { ...l, ...patch } : l)) });
  }

  function removeLine(lineId: string) {
    if (!form) return;
    update({ lines: form.lines.filter((l) => l.id !== lineId) });
  }

  /* -- Invoice actions --------------------------------------------------- */

  // The PDF is rendered server-side from the saved document, so anything still
  // sitting in the debounce has to land before the sheet opens.
  async function openShare() {
    if (timer.current) clearTimeout(timer.current);
    if (latest.current) await flush(latest.current).catch(() => {});
    setSharing(true);
  }

  async function setStatus(status: "open" | "cancelled") {
    const saved = await saveInvoice(id, { status });
    if (saved) setInvoice(saved);
  }

  async function remove() {
    await trashInvoice(id);
    clearLocal(id);
    router.push("/invoices");
  }

  /* -- Render ------------------------------------------------------------ */

  if (missing) {
    return (
      <main className="px-4 py-16 text-center">
        <p className="display text-xl">That invoice isn&rsquo;t here</p>
        <p className="mt-1 text-sm text-[var(--ink-2)]">It may have been deleted.</p>
        <Link href="/invoices" className="btn btn-ink mt-5 inline-flex">
          Back to invoices
        </Link>
      </main>
    );
  }
  if (!form || !invoice || !totals) {
    return error ? (
      <div className="px-4 py-6">
        <ErrorNote>{error}</ErrorNote>
      </div>
    ) : (
      <Loading label="Opening invoice" />
    );
  }

  const cancelled = invoice.status === "cancelled";
  const payStatus = derivePayStatus(totals.total, paid);
  // The preview/share/print copy always reflects what's on screen right now.
  const live: Invoice = {
    ...invoice,
    ...form,
    totals,
    amountPaid: paid,
    balance,
    payStatus,
  };

  return (
    <main>
      {/* Top bar */}
      <header className="no-print sticky top-0 z-30 flex items-center gap-2 border-b border-[var(--rule)] bg-[var(--paper)]/95 px-3 py-2.5 backdrop-blur">
        <Link
          href="/invoices"
          aria-label="Back to invoices"
          className="rounded-lg p-1.5 text-[var(--ink-2)] hover:bg-[var(--sunken)]"
        >
          <ChevronLeft size={22} />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="figure text-sm font-semibold leading-tight">
            {invoiceNumberLabel(invoice.number)}
          </div>
          <div className="text-xs leading-tight text-[var(--ink-3)]">
            {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : "Up to date"}
          </div>
        </div>
        <StatusPill payStatus={payStatus} status={invoice.status} />
        <button
          className="btn btn-ink px-3"
          onClick={openShare}
          aria-label="Share invoice"
        >
          <Share2 size={17} />
        </button>
      </header>

      {cancelled && (
        <div className="no-print border-b border-[var(--rule)] bg-[var(--sunken)] px-4 py-2.5 text-sm text-[var(--ink-2)]">
          This invoice is cancelled. It stays on file but counts towards nothing.{" "}
          <button className="font-semibold text-[var(--ink)] underline" onClick={() => setStatus("open")}>
            Restore it
          </button>
        </div>
      )}

      {/* School */}
      <section className="no-print border-b border-[var(--rule)] px-4 py-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="eyebrow">Billed to</span>
          <button
            className="text-xs font-semibold text-[var(--gold)] underline underline-offset-2"
            onClick={() => setPickCustomer(true)}
          >
            {form.customerId ? "Change school" : "Choose school"}
          </button>
        </div>
        <input
          className="field font-medium"
          placeholder="School or customer name"
          value={form.customerName}
          onChange={(e) => update({ customerName: e.target.value, customerId: null })}
          aria-label="Customer name"
        />
        <div className="mt-2 grid grid-cols-2 gap-2">
          <input
            className="field"
            type="tel"
            inputMode="tel"
            placeholder="Phone"
            value={form.customerPhone}
            onChange={(e) => update({ customerPhone: e.target.value })}
            aria-label="Customer phone"
          />
          <input
            className="field"
            type="date"
            value={form.date}
            onChange={(e) => update({ date: e.target.value || today() })}
            aria-label="Invoice date"
          />
        </div>
        <input
          className="field mt-2"
          placeholder="Address"
          value={form.customerAddress}
          onChange={(e) => update({ customerAddress: e.target.value })}
          aria-label="Customer address"
        />
        {form.customerId && (
          <Link
            href={`/customers/${form.customerId}`}
            className="mt-2 inline-block text-xs text-[var(--gold)] underline underline-offset-2"
          >
            Open this school&rsquo;s record
          </Link>
        )}
      </section>

      {/* Books */}
      <section className="no-print border-b border-[var(--rule)] px-4 py-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="eyebrow">Books</span>
          <span className="text-xs text-[var(--ink-3)]">
            {totals.qty} {totals.qty === 1 ? "copy" : "copies"}
          </span>
        </div>

        {form.lines.length === 0 && (
          <p className="py-3 text-sm text-[var(--ink-3)]">
            Nothing on this invoice yet. Type a book name below to add it.
          </p>
        )}

        <ul className="space-y-2">
          {form.lines.map((l) => (
            <LineRow
              key={l.id}
              line={l}
              onPatch={(p) => patchLine(l.id, p)}
              onRemove={() => removeLine(l.id)}
            />
          ))}
        </ul>

        <BookAutocomplete onAdd={addBook} />
      </section>

      {/* Money */}
      <section className="no-print border-b border-[var(--rule)] px-4 py-4">
        <span className="eyebrow">Totals</span>
        <div className="ruled mt-2">
          <TotalRow label="Subtotal" value={<Money value={totals.subtotal} />} />
          <div className="flex items-center justify-between gap-3 py-2">
            <label className="flex items-center gap-2 text-sm text-[var(--ink-2)]" htmlFor="discount">
              Discount
              <input
                id="discount"
                className="field figure w-16 px-2 py-1 text-right"
                type="number"
                inputMode="decimal"
                min={0}
                max={100}
                value={form.discountPercent || ""}
                placeholder="0"
                onChange={(e) =>
                  update({ discountPercent: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })
                }
              />
              <span className="text-sm">%</span>
            </label>
            {/* Sign outside the figure, so it reads "−₦37,560" not "₦-37,560". */}
            <span
              className="figure text-sm"
              style={{ color: totals.discount > 0 ? "var(--debit)" : "var(--ink-3)" }}
            >
              {totals.discount > 0 ? "−" : ""}
              {formatMoney(totals.discount)}
            </span>
          </div>
          <div className="flex items-baseline justify-between py-2.5">
            <span className="font-semibold">Grand total</span>
            <span className="figure text-[1.4rem] leading-none">{formatMoney(totals.total)}</span>
          </div>
        </div>
      </section>

      {/* Payments */}
      <section className="no-print border-b border-[var(--rule)] px-4 py-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="eyebrow">Payments</span>
          <span className="text-xs text-[var(--ink-3)]">
            {form.payments.length} recorded
          </span>
        </div>

        {form.payments.length > 0 && (
          <ul className="ruled">
            {form.payments.map((p) => (
              <li key={p.id} className="flex items-center gap-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="figure block text-sm">{formatDate(p.date)}</span>
                  <span className="block text-xs text-[var(--ink-3)]">
                    {p.method}
                    {p.note ? ` · ${p.note}` : ""}
                  </span>
                </span>
                <Money value={p.amount} tone="credit" className="text-sm" />
                <button
                  aria-label="Remove payment"
                  className="rounded-lg p-1 text-[var(--ink-3)] hover:bg-[var(--sunken)] hover:text-[var(--debit)]"
                  onClick={() => update({ payments: form.payments.filter((x) => x.id !== p.id) })}
                >
                  <X size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}

        {addingPayment ? (
          <PaymentForm
            suggested={Math.max(0, balance)}
            onCancel={() => setAddingPayment(false)}
            onAdd={(p) => {
              update({ payments: [...form.payments, p] });
              setAddingPayment(false);
            }}
          />
        ) : (
          <button className="btn btn-quiet mt-3 w-full" onClick={() => setAddingPayment(true)}>
            <Plus size={17} /> Record a payment
          </button>
        )}

        <div className="mt-4 flex items-baseline justify-between border-t-2 border-[var(--ink)] pt-3">
          <span className="font-semibold">
            {balance > 0.01 ? "Balance owing" : balance < -0.01 ? "Overpaid by" : "Settled"}
          </span>
          <span
            className="figure text-[1.4rem] leading-none"
            style={{ color: balance > 0.01 ? "var(--debit)" : "var(--credit)" }}
          >
            {formatMoney(Math.abs(balance))}
          </span>
        </div>
        <p className="mt-1 text-xs text-[var(--ink-3)]">
          Paid {formatMoney(paid)} of {formatMoney(totals.total)}
        </p>
      </section>

      {/* Notes */}
      <section className="no-print border-b border-[var(--rule)] px-4 py-4">
        <Labelled label="Notes" hint="Prints on the invoice.">
          <textarea
            className="field mt-1"
            rows={2}
            placeholder="Delivery on Friday. Balance due end of term."
            value={form.notes}
            onChange={(e) => update({ notes: e.target.value })}
          />
        </Labelled>
      </section>

      {/* Danger */}
      <section className="no-print px-4 py-5">
        <div className="flex gap-2">
          {!cancelled && (
            <button className="btn btn-quiet flex-1" onClick={() => setStatus("cancelled")}>
              <Ban size={16} /> Cancel invoice
            </button>
          )}
          <button className="btn btn-danger flex-1" onClick={() => setConfirmDelete(true)}>
            <Trash2 size={16} /> Delete
          </button>
        </div>
        <p className="mt-2 text-xs text-[var(--ink-3)]">
          Cancelling keeps the record but removes it from every total. Deleting moves it to the bin,
          where you can still get it back.
        </p>
      </section>

      {/* Printing prints the document, never the editor. */}
      <div className="print-only">
        <InvoiceDocument invoice={live} business={business} toggles={toggles} />
      </div>

      {pickCustomer && (
        <CustomerPicker
          onClose={() => setPickCustomer(false)}
          onPick={(c) =>
            update({
              customerId: c.id,
              customerName: c.name,
              customerPhone: c.phone,
              customerAddress: c.address,
            })
          }
        />
      )}
      <ShareSheet open={sharing} invoice={live} onClose={() => setSharing(false)} />

      {confirmDelete && (
        <div className="no-print fixed inset-0 z-50 flex items-center justify-center p-6">
          <button className="fade-in absolute inset-0 bg-[rgba(22,34,58,0.4)]" onClick={() => setConfirmDelete(false)} aria-label="Cancel" />
          <div className="sheet-in card relative w-full max-w-sm p-5" role="dialog" aria-modal="true">
            <p className="display text-lg">Delete {invoiceNumberLabel(invoice.number)}?</p>
            <p className="mt-1 text-sm text-[var(--ink-2)]">
              It moves to the bin and drops out of every report. You can restore it from there.
            </p>
            <div className="mt-4 flex gap-2">
              <button className="btn btn-quiet flex-1" onClick={() => setConfirmDelete(false)}>
                Keep it
              </button>
              <button className="btn btn-danger flex-1" onClick={remove}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

/* -- One book on the invoice --------------------------------------------- */

function LineRow({
  line,
  onPatch,
  onRemove,
}: {
  line: Line;
  onPatch: (p: Partial<Line>) => void;
  onRemove: () => void;
}) {
  return (
    <li className="card flex gap-2.5 p-2.5">
      <Spine color={spineColor(line.publisher)} title={line.publisher} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <input
            className="field flex-1 py-1 font-medium"
            value={line.name}
            onChange={(e) => onPatch({ name: e.target.value })}
            aria-label="Book name"
          />
          <button
            aria-label="Remove book"
            className="mt-1 rounded-lg p-1 text-[var(--ink-3)] hover:bg-[var(--sunken)] hover:text-[var(--debit)]"
            onClick={onRemove}
          >
            <X size={16} />
          </button>
        </div>

        <div className="mt-2 flex items-center gap-2">
          <label className="flex items-center gap-1.5">
            <span className="sr-only">Quantity</span>
            <input
              className="field figure w-16 py-1 text-right"
              type="number"
              inputMode="numeric"
              min={0}
              value={line.qty}
              onChange={(e) => onPatch({ qty: Math.max(0, Number(e.target.value) || 0) })}
            />
          </label>
          <span className="text-sm text-[var(--ink-3)]">×</span>
          <label className="flex min-w-0 flex-1 items-center gap-1">
            <span className="sr-only">Unit price</span>
            <span className="text-sm text-[var(--ink-3)]">₦</span>
            <input
              className="field figure w-full py-1 text-right"
              type="number"
              inputMode="decimal"
              min={0}
              value={line.unitPrice}
              onChange={(e) => onPatch({ unitPrice: Math.max(0, Number(e.target.value) || 0) })}
            />
          </label>
          <span className="figure w-24 shrink-0 text-right text-sm font-semibold">
            {formatMoney(lineTotal(line))}
          </span>
        </div>
      </div>
    </li>
  );
}

/** Drop `savedAt` and any absent keys so the mirror only overrides what it holds. */
function stripUndefined(local: Record<string, unknown>): Partial<Editable> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(local)) {
    if (k !== "savedAt" && v !== undefined) out[k] = v;
  }
  return out as Partial<Editable>;
}

function TotalRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2 text-sm">
      <span className="text-[var(--ink-2)]">{label}</span>
      {value}
    </div>
  );
}

/* -- Recording a payment -------------------------------------------------- */

function PaymentForm({
  suggested,
  onAdd,
  onCancel,
}: {
  suggested: number;
  onAdd: (p: Payment) => void;
  onCancel: () => void;
}) {
  const [amount, setAmount] = useState(suggested > 0 ? String(suggested) : "");
  const [method, setMethod] = useState<PaymentMethod>("Cash");
  const [date, setDate] = useState(today());
  const [note, setNote] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = Number(amount) || 0;
    if (value <= 0) return;
    onAdd({
      id: `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      amount: value,
      method,
      date,
      note: note.trim(),
    });
  }

  return (
    <form onSubmit={submit} className="card mt-3 space-y-2.5 p-3">
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="eyebrow">Amount</span>
          <input
            className="field figure mt-1"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            autoFocus
          />
        </label>
        <label className="block">
          <span className="eyebrow">Date</span>
          <input
            className="field mt-1"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value || today())}
          />
        </label>
      </div>

      <div>
        <span className="eyebrow">Method</span>
        <div className="segment mt-1 flex-wrap" role="group" aria-label="Payment method">
          {PAYMENT_METHODS.map((m) => (
            <button
              key={m}
              type="button"
              data-on={m === method}
              aria-pressed={m === method}
              onClick={() => setMethod(m)}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      <input
        className="field"
        placeholder="Reference or note (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        aria-label="Payment note"
      />

      <div className="flex gap-2">
        <button type="button" className="btn btn-quiet flex-1" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn btn-ink flex-1" disabled={!(Number(amount) > 0)}>
          <Check size={16} /> Add payment
        </button>
      </div>
    </form>
  );
}
