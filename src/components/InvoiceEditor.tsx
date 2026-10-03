"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Ban,
  BookPlus,
  Check,
  ChevronLeft,
  Eye,
  EyeOff,
  Plus,
  RefreshCw,
  Share2,
  Trash2,
  X,
} from "lucide-react";
import BookAutocomplete from "@/components/BookAutocomplete";
import CustomerPicker from "@/components/CustomerPicker";
import ShareSheet from "@/components/ShareSheet";
import InvoiceDocument from "@/components/InvoiceDocument";
import ScaledPreview from "@/components/ScaledPreview";
import { ErrorNote, Labelled, Loading, Money, Spine, StatusPill } from "@/components/ui";
import {
  clearLocal,
  createBook,
  getArrears,
  getBooks,
  getInvoice,
  listSchoolPrices,
  loadLocal,
  saveInvoice,
  saveLocal,
  setSchoolPrice,
  trashInvoice,
  updateBook,
  type Arrears,
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
import { useAutosave, saveLabel } from "@/lib/use-autosave";
import { useBusiness, useHeaderToggles } from "@/lib/use-settings";

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
  carryForward: boolean;
};

const PREVIEW_PREF = "pb.previewOnDesktop";

const EMPTY_PRICES: Map<string, number> = new Map();

function readPreviewPref(): boolean {
  try {
    return localStorage.getItem(PREVIEW_PREF) !== "0";
  } catch {
    return true;
  }
}

export default function InvoiceEditor({ id }: { id: string }) {
  const router = useRouter();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [form, setForm] = useState<Editable | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState("");

  const [pickCustomer, setPickCustomer] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [addingPayment, setAddingPayment] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Read once, at first render. The editor renders nothing but a spinner until
  // the invoice arrives, so this never reaches the server-rendered HTML.
  const [showPreview, setShowPreview] = useState(readPreviewPref);

  // What this school pays, where it differs from the general price, and what
  // the general price is right now — the two numbers an edited price is judged
  // against before anything is offered to be saved. Both are stamped with the
  // school they belong to, so a half-loaded price list can never be read as
  // belonging to a school it isn't for.
  const [prices, setPrices] = useState<{ customerId: string; map: Map<string, number> } | null>(
    null
  );
  const [owing, setOwing] = useState<{ customerId: string; arrears: Arrears } | null>(null);
  const [shelf, setShelf] = useState<Map<string, Book>>(new Map());

  // The letterhead for the preview and the print-only copy.
  const business = useBusiness();
  const toggles = useHeaderToggles();

  /* -- Save --------------------------------------------------------------
     One request in the air at a time, newest state always wins, failures retry
     and say so. See src/lib/use-autosave.ts.
     -------------------------------------------------------------------- */

  const autosave = useAutosave<Editable>({
    save: async (data, { keepalive }) => {
      const saved = await saveInvoice(id, data as InvoicePatch, { keepalive });
      setInvoice(saved);
    },
    mirror: (data) => saveLocal(id, data),
    clearMirror: () => clearLocal(id),
  });
  const { queue, flush } = autosave;

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

  /* -- Load -------------------------------------------------------------- */

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
          carryForward: inv.carryForward,
        };
        // A local mirror newer than the server copy means the last debounced
        // save never landed — prefer whatever it holds.
        const local = loadLocal(id);
        const fresh = local && local.savedAt > new Date(inv.updatedAt).getTime();
        setForm(fresh ? { ...server, ...stripUndefined(local) } : server);
      })
      .catch((e: Error) => setError(e.message));
  }, [id]);

  // The general price of every book on the invoice, as it stands today.
  const lineBookIds = form?.lines.map((l) => l.bookId).filter(Boolean).join(",") ?? "";
  useEffect(() => {
    const ids = lineBookIds.split(",").filter(Boolean);
    if (!ids.length) return;
    getBooks(ids)
      .then((books) =>
        setShelf((prev) => {
          const next = new Map(prev);
          for (const b of books) next.set(b.id, b);
          return next;
        })
      )
      .catch(() => {});
  }, [lineBookIds]);

  // This school's own prices, and what they still owe elsewhere. Both follow
  // the school, so both are reloaded whenever it changes.
  const customerId = form?.customerId ?? null;
  useEffect(() => {
    if (!customerId) return;
    let live = true;
    listSchoolPrices(customerId)
      .then((rows) => {
        if (live) {
          setPrices({ customerId, map: new Map(rows.map((r) => [r.bookId, r.sellingPrice])) });
        }
      })
      .catch(() => {});
    getArrears(customerId, id)
      .then((arrears) => live && setOwing({ customerId, arrears }))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [customerId, id]);

  // Only ever this school's figures — anything still loading reads as empty
  // rather than as the last school's.
  const schoolPrices =
    customerId && prices?.customerId === customerId ? prices.map : EMPTY_PRICES;
  const arrears = customerId && owing?.customerId === customerId ? owing.arrears : null;

  /* -- Derived (recomputed locally so the screen never lags the keystroke) */

  const totals = useMemo(
    () => (form ? computeTotals(form.lines, form.discountPercent) : null),
    [form]
  );
  const paid = useMemo(() => (form ? sumPayments(form.payments) : 0), [form]);
  const balance = totals ? round2(totals.total - paid) : 0;
  // Live, so ticking the box shows the figure at once. The server recomputes
  // exactly this on every save, so the two never drift apart.
  const broughtForward =
    form?.carryForward ? (arrears?.amount ?? invoice?.broughtForward ?? 0) : 0;
  const due = round2(balance + broughtForward);

  /* -- Line actions ------------------------------------------------------ */

  function addBook(b: Book) {
    if (!form) return;
    setShelf((prev) => new Map(prev).set(b.id, b));
    const line: Line = {
      id: `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      bookId: b.id,
      name: b.name,
      publisher: b.publisher,
      category: b.category,
      qty: 1,
      // This school's price wins over the general one. That is the whole point
      // of a school price: the rate agreed with them is the rate they get.
      unitPrice: schoolPrices.get(b.id) ?? b.sellingPrice,
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

  // Keep the shelf in step with what's on the invoice. A line with no book
  // behind it (typed by hand or brought in by import) gets one created and
  // linked; a line already linked pushes its edited name/publisher back to that
  // book. Note it does NOT push the price: an invoice price is this sale's
  // price, and changing the shelf's price is offered separately, by name.
  async function syncLineToShelf(lineId: string) {
    if (!form) return;
    const line = form.lines.find((l) => l.id === lineId);
    const name = line?.name.trim();
    if (!line || !name) return;
    if (line.bookId) {
      const book = await updateBook(line.bookId, {
        name,
        publisher: line.publisher || "",
        costPrice: line.costPrice || 0,
      });
      setShelf((prev) => new Map(prev).set(book.id, book));
    } else {
      const book = await createBook({
        name,
        publisher: line.publisher || "",
        costPrice: line.costPrice || 0,
        sellingPrice: line.unitPrice || 0,
      });
      setShelf((prev) => new Map(prev).set(book.id, book));
      patchLine(lineId, { bookId: book.id });
    }
  }

  /** Remember this price for this school only. The general price is untouched. */
  async function saveAsSchoolPrice(bookId: string, price: number) {
    if (!customerId) return;
    await setSchoolPrice(customerId, bookId, price);
    setPrices((prev) => ({
      customerId,
      map: new Map(prev?.customerId === customerId ? prev.map : []).set(bookId, price),
    }));
  }

  /** Change the price everyone pays. Only ever on an explicit tap. */
  async function saveAsGeneralPrice(bookId: string, price: number) {
    const book = await updateBook(bookId, { sellingPrice: price });
    setShelf((prev) => new Map(prev).set(book.id, book));
  }

  /* -- Invoice actions --------------------------------------------------- */

  // The PDF is rendered server-side from the saved document, so anything still
  // sitting in the debounce has to land before the sheet opens.
  async function openShare() {
    await flush().catch(() => {});
    setSharing(true);
  }

  async function setStatus(status: "open" | "cancelled") {
    const saved = await saveInvoice(id, { status }).catch(() => null);
    if (saved) setInvoice(saved);
  }

  async function remove() {
    await trashInvoice(id);
    clearLocal(id);
    router.push("/invoices");
  }

  function togglePreview() {
    setShowPreview((on) => {
      try {
        localStorage.setItem(PREVIEW_PREF, on ? "0" : "1");
      } catch {}
      return !on;
    });
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
    broughtForward,
    totals,
    amountPaid: paid,
    balance,
    payStatus,
  };

  return (
    <main className={showPreview ? "editor-wide" : undefined}>
      <div className="editor-grid">
        <div className="min-w-0">
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
              <div
                className="text-xs leading-tight"
                style={{
                  color: autosave.status === "retrying" ? "var(--debit)" : "var(--ink-3)",
                }}
                role="status"
              >
                {saveLabel(autosave.status)}
              </div>
            </div>
            <StatusPill payStatus={payStatus} status={invoice.status} />
            {/* Desktop only: the preview lives beside the form, so it can be
                put away when the form needs the width. */}
            <button
              className="btn btn-quiet hidden px-2.5 editor-preview-toggle"
              onClick={togglePreview}
              aria-pressed={showPreview}
              aria-label={showPreview ? "Hide the preview" : "Show the preview"}
              title={showPreview ? "Hide the preview" : "Show the preview"}
            >
              {showPreview ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
            <button className="btn btn-ink px-3" onClick={openShare} aria-label="Share invoice">
              <Share2 size={17} />
            </button>
          </header>

          {autosave.status === "retrying" && (
            <div className="no-print border-b border-[var(--rule)] bg-[var(--debit-soft)] px-4 py-2.5 text-sm text-[var(--debit)]">
              <span className="font-semibold">Not saved yet.</span> {autosave.error} Your typing is
              safe on this device and will go up by itself.{" "}
              <button className="font-semibold underline" onClick={autosave.retry}>
                <RefreshCw size={12} className="inline" /> Try now
              </button>
            </div>
          )}

          {cancelled && (
            <div className="no-print border-b border-[var(--rule)] bg-[var(--sunken)] px-4 py-2.5 text-sm text-[var(--ink-2)]">
              This invoice is cancelled. It stays on file but counts towards nothing.{" "}
              <button
                className="font-semibold text-[var(--ink)] underline"
                onClick={() => setStatus("open")}
              >
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
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              {form.customerId && (
                <Link
                  href={`/customers/${form.customerId}`}
                  className="text-xs text-[var(--gold)] underline underline-offset-2"
                >
                  Open this school&rsquo;s record
                </Link>
              )}
              {schoolPrices.size > 0 && (
                <span className="text-xs text-[var(--ink-3)]">
                  {schoolPrices.size} book{schoolPrices.size === 1 ? " has" : "s have"} a price
                  agreed with this school
                </span>
              )}
            </div>
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
                  schoolName={form.customerName}
                  canSaveSchoolPrice={!!form.customerId}
                  schoolPrice={l.bookId ? schoolPrices.get(l.bookId) ?? null : null}
                  generalPrice={l.bookId ? shelf.get(l.bookId)?.sellingPrice ?? null : null}
                  onPatch={(p) => patchLine(l.id, p)}
                  onRemove={() => removeLine(l.id)}
                  onSyncToShelf={() => syncLineToShelf(l.id)}
                  onSaveSchoolPrice={(price) => saveAsSchoolPrice(l.bookId!, price)}
                  onSaveGeneralPrice={(price) => saveAsGeneralPrice(l.bookId!, price)}
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
                <label
                  className="flex items-center gap-2 text-sm text-[var(--ink-2)]"
                  htmlFor="discount"
                >
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
                      update({
                        discountPercent: Math.min(100, Math.max(0, Number(e.target.value) || 0)),
                      })
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
                <span className="figure text-[1.4rem] leading-none">
                  {formatMoney(totals.total)}
                </span>
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
                      onClick={() =>
                        update({ payments: form.payments.filter((x) => x.id !== p.id) })
                      }
                    >
                      <X size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {addingPayment ? (
              <PaymentForm
                suggested={Math.max(0, due)}
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

            <CarryForward
              on={form.carryForward}
              arrears={arrears}
              saved={invoice.broughtForward}
              balance={balance}
              due={due}
              customerId={form.customerId}
              onToggle={(carryForward) => update({ carryForward })}
            />
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
              Cancelling keeps the record but removes it from every total. Deleting moves it to the
              bin, where you can still get it back.
            </p>
          </section>
        </div>

        {/* The live copy, beside the form on a desktop screen. It is the same
            component that prints and that the share sheet exports, so what he
            sees while typing is literally what leaves the building. */}
        {showPreview && (
          <aside className="editor-preview no-print" aria-label="Invoice preview">
            <div className="editor-preview-inner">
              <div className="mb-2 flex items-center justify-between">
                <span className="eyebrow">Preview</span>
                <span className="text-xs text-[var(--ink-3)]">Updates as you type</span>
              </div>
              <div className="card overflow-hidden">
                <ScaledPreview width={680}>
                  <InvoiceDocument invoice={live} business={business} toggles={toggles} />
                </ScaledPreview>
              </div>
            </div>
          </aside>
        )}
      </div>

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
          <button
            className="fade-in absolute inset-0 bg-[rgba(22,34,58,0.4)]"
            onClick={() => setConfirmDelete(false)}
            aria-label="Cancel"
          />
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

/* -- Bringing an old balance forward -------------------------------------- */

function CarryForward({
  on,
  arrears,
  saved,
  balance,
  due,
  customerId,
  onToggle,
}: {
  on: boolean;
  arrears: Arrears | null;
  saved: number;
  balance: number;
  due: number;
  customerId: string | null;
  onToggle: (on: boolean) => void;
}) {
  const owed = arrears?.amount ?? (on ? saved : 0);
  const count = arrears?.invoiceCount ?? 0;

  // Nothing to carry and nothing being carried — don't clutter the screen with
  // an offer that would only ever add zero.
  if (!customerId || (owed <= 0.01 && !on)) return null;

  return (
    <div className="mt-4 rounded-xl border border-[var(--rule)] bg-[var(--sunken)] px-3.5 py-3">
      <label className="flex cursor-pointer items-start gap-2.5">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={on}
          onChange={(e) => onToggle(e.target.checked)}
        />
        <span className="min-w-0 flex-1 text-sm">
          <span className="font-semibold">Bring their old balance forward</span>
          <span className="mt-0.5 block text-xs text-[var(--ink-2)]">
            {owed > 0.01 ? (
              <>
                They still owe {formatMoney(owed)} on {count} earlier{" "}
                {count === 1 ? "invoice" : "invoices"}. Showing it here doesn&rsquo;t move the debt —
                those invoices keep it, so no figure is counted twice.
              </>
            ) : (
              <>Nothing outstanding on their other invoices right now.</>
            )}
          </span>
        </span>
      </label>

      {on && (
        <div className="ruled mt-3 border-t border-[var(--rule)] pt-1">
          <div className="flex items-baseline justify-between py-1.5 text-sm">
            <span className="text-[var(--ink-2)]">Balance on this invoice</span>
            <span className="figure">{formatMoney(Math.max(0, balance))}</span>
          </div>
          <div className="flex items-baseline justify-between py-1.5 text-sm">
            <span className="text-[var(--ink-2)]">Brought forward</span>
            <span className="figure">{formatMoney(owed)}</span>
          </div>
          <div className="flex items-baseline justify-between py-2">
            <span className="font-semibold">Total due</span>
            <span className="figure text-lg" style={{ color: "var(--debit)" }}>
              {formatMoney(Math.max(0, due))}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/* -- One book on the invoice --------------------------------------------- */

function LineRow({
  line,
  schoolName,
  canSaveSchoolPrice,
  schoolPrice,
  generalPrice,
  onPatch,
  onRemove,
  onSyncToShelf,
  onSaveSchoolPrice,
  onSaveGeneralPrice,
}: {
  line: Line;
  schoolName: string;
  canSaveSchoolPrice: boolean;
  schoolPrice: number | null;
  generalPrice: number | null;
  onPatch: (p: Partial<Line>) => void;
  onRemove: () => void;
  onSyncToShelf: () => Promise<void>;
  onSaveSchoolPrice: (price: number) => Promise<void>;
  onSaveGeneralPrice: (price: number) => Promise<void>;
}) {
  const [shelfState, setShelfState] = useState<"idle" | "busy" | "done">("idle");
  const [priceAsk, setPriceAsk] = useState(false);
  const [priceSaved, setPriceSaved] = useState("");
  const linked = !!line.bookId;

  async function syncToShelf() {
    setShelfState("busy");
    try {
      await onSyncToShelf();
      setShelfState("done");
      setTimeout(() => setShelfState("idle"), 1800);
    } catch {
      setShelfState("idle");
    }
  }

  const shelfLabel =
    shelfState === "busy"
      ? linked
        ? "Updating…"
        : "Saving…"
      : shelfState === "done"
      ? linked
        ? "Updated ✓"
        : "Saved ✓"
      : linked
      ? "Update shelf"
      : "Save to shelf";

  // The price this line *would* have carried if nobody had touched it.
  const standing = schoolPrice ?? generalPrice;
  const differs = standing !== null && Math.abs(line.unitPrice - standing) > 0.005;

  /**
   * An edited price stays on this invoice and nowhere else unless he says so.
   * The offer is only raised when the price actually departs from the standing
   * one, and only once he has finished typing it.
   */
  function checkPrice() {
    if (!linked || !differs) {
      setPriceAsk(false);
      return;
    }
    setPriceSaved("");
    setPriceAsk(true);
  }

  async function keepFor(where: "school" | "general") {
    try {
      if (where === "school") {
        await onSaveSchoolPrice(line.unitPrice);
        setPriceSaved(`Saved as ${schoolName.trim() || "this school"}'s price`);
      } else {
        await onSaveGeneralPrice(line.unitPrice);
        setPriceSaved("General price updated");
      }
      setPriceAsk(false);
    } catch {
      setPriceSaved("Couldn't save that price");
    }
  }

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

        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          {line.name.trim() && (
            <button
              type="button"
              className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--gold)] disabled:opacity-60"
              onClick={syncToShelf}
              disabled={shelfState !== "idle"}
            >
              <BookPlus size={13} />
              {shelfLabel}
            </button>
          )}
          {schoolPrice !== null && !differs && (
            <span className="text-xs text-[var(--credit)]">
              At this school&rsquo;s agreed price
            </span>
          )}
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
              onBlur={checkPrice}
            />
          </label>
          <span className="figure w-24 shrink-0 text-right text-sm font-semibold">
            {formatMoney(lineTotal(line))}
          </span>
        </div>

        {priceSaved && !priceAsk && (
          <p className="mt-1.5 text-xs text-[var(--credit)]">{priceSaved}</p>
        )}

        {priceAsk && standing !== null && (
          <div className="mt-2 rounded-lg bg-[var(--sunken)] px-2.5 py-2 text-xs">
            <p className="text-[var(--ink-2)]">
              {formatMoney(line.unitPrice)} instead of {formatMoney(standing)}
              {schoolPrice !== null ? " agreed with this school" : " on the shelf"}. Keep it for
              this invoice only, or remember it?
            </p>
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
              {canSaveSchoolPrice && (
                <button
                  className="font-semibold text-[var(--gold)]"
                  onClick={() => void keepFor("school")}
                >
                  Always this price for {schoolName.trim() || "this school"}
                </button>
              )}
              <button
                className="font-semibold text-[var(--ink-2)]"
                onClick={() => void keepFor("general")}
              >
                Change the general price
              </button>
              <button className="text-[var(--ink-3)]" onClick={() => setPriceAsk(false)}>
                Just this invoice
              </button>
            </div>
          </div>
        )}
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
