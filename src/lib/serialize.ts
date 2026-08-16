import type {
  Book,
  BookDoc,
  Customer,
  CustomerDoc,
  Invoice,
  InvoiceDoc,
  InvoiceStatus,
  Line,
  Payment,
  PaymentMethod,
} from "@/lib/types";
import {
  PAYMENT_METHODS,
  clampPercent,
  computeTotals,
  derivePayStatus,
  sumPayments,
} from "@/lib/types";
import { isYmd, today } from "@/lib/datetime";

/* ---- Doc -> wire ------------------------------------------------------- */

export function toBook(d: BookDoc): Book {
  return {
    id: String(d._id),
    shortName: d.shortName || "",
    fullName: d.fullName || "",
    publisher: d.publisher || "",
    category: d.category || "",
    costPrice: num(d.costPrice),
    sellingPrice: num(d.sellingPrice),
    archived: !!d.archived,
    createdAt: iso(d.createdAt),
    updatedAt: iso(d.updatedAt),
  };
}

export function toCustomer(d: CustomerDoc): Customer {
  return {
    id: String(d._id),
    name: d.name || "",
    phone: d.phone || "",
    address: d.address || "",
    notes: d.notes || "",
    archived: !!d.archived,
    createdAt: iso(d.createdAt),
    updatedAt: iso(d.updatedAt),
  };
}

export function toInvoice(d: InvoiceDoc): Invoice {
  const lines = sanitizeLines(d.lines);
  const payments = sanitizePayments(d.payments);
  // Recompute on read as well as write: a doc written by an older shape (or
  // hand-edited in Atlas) still reports correct money.
  const totals = computeTotals(lines, d.discountPercent || 0);
  const amountPaid = sumPayments(payments);
  return {
    id: String(d._id),
    number: num(d.number),
    customerId: d.customerId || null,
    customerName: d.customerName || "",
    customerPhone: d.customerPhone || "",
    customerAddress: d.customerAddress || "",
    lines,
    date: isYmd(d.date) ? d.date : today(),
    discountPercent: clampPercent(d.discountPercent || 0),
    payments,
    notes: d.notes || "",
    status: d.status === "cancelled" || d.status === "open" ? d.status : "draft",
    totals,
    amountPaid,
    balance: Math.round((totals.total - amountPaid) * 100) / 100,
    payStatus: derivePayStatus(totals.total, amountPaid),
    deleted: !!d.deleted,
    deletedAt: d.deletedAt ? iso(d.deletedAt) : null,
    createdAt: iso(d.createdAt),
    updatedAt: iso(d.updatedAt),
  };
}

/* ---- Wire -> doc (never trust the client) ------------------------------ */

export function sanitizeLines(input: unknown): Line[] {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 500).map((raw, i) => {
    const l = (raw || {}) as Partial<Line>;
    return {
      id: str(l.id, 40) || `l${i}-${Math.random().toString(36).slice(2, 8)}`,
      bookId: typeof l.bookId === "string" && l.bookId ? l.bookId : null,
      shortName: str(l.shortName, 200),
      fullName: str(l.fullName, 300),
      nameMode: l.nameMode === "full" ? "full" : "short",
      publisher: str(l.publisher, 120),
      category: str(l.category, 120),
      qty: clampNum(l.qty, 0, 1_000_000),
      unitPrice: clampNum(l.unitPrice, 0, 100_000_000),
      costPrice: clampNum(l.costPrice, 0, 100_000_000),
    };
  });
}

export function sanitizePayments(input: unknown): Payment[] {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 200).map((raw, i) => {
    const p = (raw || {}) as Partial<Payment>;
    const method = PAYMENT_METHODS.includes(p.method as PaymentMethod)
      ? (p.method as PaymentMethod)
      : "Cash";
    return {
      id: str(p.id, 40) || `p${i}-${Math.random().toString(36).slice(2, 8)}`,
      amount: clampNum(p.amount, 0, 1_000_000_000),
      method,
      date: isYmd(p.date) ? p.date : today(),
      note: str(p.note, 200),
    };
  });
}

/**
 * An invoice graduates from draft to a real sale as soon as it names a customer
 * and has something on it — there's no "confirm" step to forget. Cancelled
 * invoices stay cancelled.
 *
 * Shared by both write paths: the editor's autosave PATCH reaches it a keystroke
 * at a time, while an imported order arrives complete on the initial POST and
 * would otherwise sit as a draft, invisible to every report.
 */
export function promoteStatus(
  status: InvoiceStatus,
  customerName: string,
  lines: Line[]
): InvoiceStatus {
  if (status !== "draft") return status;
  const hasSale = lines.some((l) => l.qty > 0);
  return customerName.trim() && hasSale ? "open" : "draft";
}

/** The derived money fields, recomputed from lines + payments. */
export function derived(lines: Line[], discountPercent: number, payments: Payment[]) {
  const totals = computeTotals(lines, discountPercent);
  const amountPaid = sumPayments(payments);
  return {
    totals,
    amountPaid,
    balance: Math.round((totals.total - amountPaid) * 100) / 100,
    payStatus: derivePayStatus(totals.total, amountPaid),
  };
}

/* ---- small helpers ----------------------------------------------------- */

export function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.slice(0, max) : "";
}

export function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function clampNum(v: unknown, min: number, max: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function iso(d: Date | string | undefined): string {
  if (!d) return new Date().toISOString();
  return d instanceof Date ? d.toISOString() : new Date(d).toISOString();
}
