import type { Book, Customer, Invoice, Line, Payment } from "@/lib/types";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const msg = await res
      .json()
      .then((b) => (b as { error?: string }).error)
      .catch(() => null);
    throw new Error(msg || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

const NO_STORE: RequestInit = { cache: "no-store" };

/* ---- Books ------------------------------------------------------------- */

export function listBooks(q = "", archived = false): Promise<Book[]> {
  const p = new URLSearchParams();
  if (q) p.set("q", q);
  if (archived) p.set("archived", "1");
  return fetch(`/api/books?${p}`, NO_STORE).then(json<Book[]>);
}

export function createBook(data: Partial<Book>): Promise<Book> {
  return fetch("/api/books", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  }).then(json<Book>);
}

export function updateBook(id: string, data: Partial<Book>): Promise<Book> {
  return fetch(`/api/books/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  }).then(json<Book>);
}

export function archiveBook(id: string): Promise<unknown> {
  return fetch(`/api/books/${id}`, { method: "DELETE" }).then(json);
}

export function deleteBook(id: string): Promise<unknown> {
  return fetch(`/api/books/${id}?permanent=1`, { method: "DELETE" }).then(json);
}

/* ---- Customers --------------------------------------------------------- */

export function listCustomers(q = "", archived = false): Promise<Customer[]> {
  const p = new URLSearchParams();
  if (q) p.set("q", q);
  if (archived) p.set("archived", "1");
  return fetch(`/api/customers?${p}`, NO_STORE).then(json<Customer[]>);
}

export function createCustomer(data: Partial<Customer>): Promise<Customer> {
  return fetch("/api/customers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  }).then(json<Customer>);
}

export function updateCustomer(id: string, data: Partial<Customer>): Promise<Customer> {
  return fetch(`/api/customers/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  }).then(json<Customer>);
}

export function archiveCustomer(id: string): Promise<unknown> {
  return fetch(`/api/customers/${id}`, { method: "DELETE" }).then(json);
}

export function deleteCustomer(id: string): Promise<unknown> {
  return fetch(`/api/customers/${id}?permanent=1`, { method: "DELETE" }).then(json);
}

export type CustomerProfile = {
  customer: Customer;
  overview: {
    revenue: number; cost: number; profit: number; orders: number; qty: number;
    paid: number; outstanding: number; avgOrder: number;
    firstPurchase: string | null; lastPurchase: string | null;
    daysSincePurchase: number | null;
  };
  history: Invoice[];
  debts: {
    invoiceId: string; number: number; date: string;
    total: number; paid: number; balance: number; ageDays: number;
  }[];
  favourites: { name: string; publisher: string; qty: number; revenue: number }[];
  payments: (Payment & { invoiceId: string; invoiceNumber: number })[];
};

export function getCustomerProfile(id: string): Promise<CustomerProfile> {
  return fetch(`/api/customers/${id}/profile`, NO_STORE).then(json<CustomerProfile>);
}

/* ---- Invoices ---------------------------------------------------------- */

export type InvoiceQuery = {
  q?: string;
  pay?: string;
  status?: string;
  customerId?: string;
  from?: string;
  to?: string;
  limit?: number;
};

export function listInvoices(query: InvoiceQuery = {}): Promise<Invoice[]> {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== "" && v !== "all") p.set(k, String(v));
  }
  return fetch(`/api/invoices?${p}`, NO_STORE).then(json<Invoice[]>);
}

export function createInvoice(data: Partial<Invoice> = {}): Promise<Invoice> {
  return fetch("/api/invoices", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  }).then(json<Invoice>);
}

export function getInvoice(id: string): Promise<Invoice | null> {
  return fetch(`/api/invoices/${id}`, NO_STORE).then((res) => {
    if (res.status === 404) return null;
    return json<Invoice>(res);
  });
}

export type InvoicePatch = {
  customerId?: string | null;
  customerName?: string;
  customerPhone?: string;
  customerAddress?: string;
  lines?: Line[];
  date?: string;
  discountPercent?: number;
  payments?: Payment[];
  notes?: string;
  status?: "draft" | "open" | "cancelled";
  deleted?: boolean;
};

export async function saveInvoice(
  id: string,
  patch: InvoicePatch,
  opts: { keepalive?: boolean } = {}
): Promise<Invoice | null> {
  const res = await fetch(`/api/invoices/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
    keepalive: opts.keepalive,
  });
  return res.ok ? ((await res.json()) as Invoice) : null;
}

/**
 * Render the saved invoice as a PDF on the server. The letterhead is a device
 * setting, so it travels with the request.
 */
export async function fetchInvoicePdf(
  id: string,
  letterhead: { business: unknown; toggles: unknown }
): Promise<Blob> {
  const res = await fetch(`/api/invoices/${id}/pdf`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(letterhead),
  });
  if (!res.ok) throw new Error("Couldn't build the PDF. Try again.");
  return res.blob();
}

export function trashInvoice(id: string): Promise<unknown> {
  return fetch(`/api/invoices/${id}`, { method: "DELETE" }).then(json);
}

export function listTrash(): Promise<Invoice[]> {
  return fetch("/api/invoices/trash", NO_STORE).then(json<Invoice[]>);
}

export function restoreInvoice(id: string): Promise<Invoice | null> {
  return saveInvoice(id, { deleted: false });
}

export function deleteInvoiceForever(id: string): Promise<unknown> {
  return fetch(`/api/invoices/${id}?permanent=1`, { method: "DELETE" }).then(json);
}

export function emptyTrash(): Promise<unknown> {
  return fetch("/api/invoices/trash", { method: "DELETE" }).then(json);
}

/* ---- AI import --------------------------------------------------------- */

export type ExtractedBook = {
  id: string;
  name: string;
  publisher: string;
  category: string;
  costPrice: number;
  sellingPrice: number;
};

export type ExtractedItem = {
  written: string; // the title as it appeared in the source
  quantity: number;
  price: number; // from the source only — 0 when none was shown
  // A shelf book this line probably means, offered as a suggestion for the
  // user to accept. Never forced on — the line stands on its own if ignored.
  suggestion: ExtractedBook | null;
};

export type Extraction = {
  customer: {
    name: string;
    phone: string;
    address: string;
    match: Customer | null; // an existing school this order looks like
  };
  items: ExtractedItem[];
};

/** Turn a pasted list, photo, PDF or Word file into invoice lines. */
export async function extractOrder(input: {
  text?: string;
  files?: File[];
}): Promise<Extraction> {
  const hasFiles = !!input.files?.length;
  const res = hasFiles
    ? await fetch("/api/extract", { method: "POST", body: toFormData(input) })
    : await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: input.text ?? "" }),
      });
  return json<Extraction>(res);
}

function toFormData({ text, files }: { text?: string; files?: File[] }): FormData {
  const fd = new FormData();
  for (const file of files ?? []) fd.append("file", file);
  if (text?.trim()) fd.append("text", text.trim());
  return fd;
}

/* ---- Analytics --------------------------------------------------------- */

export function getOverview<T>(): Promise<T> {
  return fetch("/api/analytics/overview", NO_STORE).then(json<T>);
}

export function getAnalytics<T>(params: Record<string, string>): Promise<T> {
  return fetch(`/api/analytics?${new URLSearchParams(params)}`, NO_STORE).then(json<T>);
}

/* ---- Local mirror of the invoice being edited --------------------------
   Keeps a keystroke-level copy so a reload (or a dropped connection) before
   the debounced PATCH lands doesn't lose the line you just typed.
   ---------------------------------------------------------------------- */

const draftKey = (id: string) => `pb.draft.${id}`;

export type LocalDraft = InvoicePatch & { savedAt: number };

export function saveLocal(id: string, patch: InvoicePatch) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(draftKey(id), JSON.stringify({ ...patch, savedAt: Date.now() }));
  } catch {}
}

export function loadLocal(id: string): LocalDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(draftKey(id));
    return raw ? (JSON.parse(raw) as LocalDraft) : null;
  } catch {
    return null;
  }
}

export function clearLocal(id: string) {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(draftKey(id));
  } catch {}
}
