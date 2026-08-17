"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MessageCircle, Pencil, Phone, Plus } from "lucide-react";
import Sheet from "@/components/Sheet";
import { RankBars } from "@/components/charts";
import {
  archiveCustomer,
  createInvoice,
  deleteCustomer,
  getCustomerProfile,
  updateCustomer,
  type CustomerProfile,
} from "@/lib/client";
import { formatMoney, formatMoneyShort, invoiceNumberLabel } from "@/lib/types";
import { formatDate, relativeDays, today } from "@/lib/datetime";
import {
  Empty,
  ErrorNote,
  Labelled,
  Loading,
  Money,
  PageHeader,
  Section,
  Stat,
  StatusPill,
} from "@/components/ui";

export default function CustomerProfileView({ id }: { id: string }) {
  const router = useRouter();
  const [data, setData] = useState<CustomerProfile | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState<"history" | "debts" | "books" | "payments">("history");

  const load = useCallback(() => {
    getCustomerProfile(id)
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, [id]);

  useEffect(load, [load]);

  async function newInvoice() {
    if (!data) return;
    const inv = await createInvoice({
      date: today(),
      customerId: data.customer.id,
      customerName: data.customer.name,
      customerPhone: data.customer.phone,
      customerAddress: data.customer.address,
    });
    router.push(`/invoices/${inv.id}`);
  }

  if (error) {
    return (
      <div className="px-4 py-6">
        <ErrorNote>{error}</ErrorNote>
      </div>
    );
  }
  if (!data) return <Loading label="Loading the record" />;

  const { customer: c, overview: o } = data;

  return (
    <main>
      <PageHeader
        title={c.name}
        subtitle={[c.address, c.phone].filter(Boolean).join(" · ") || "No contact details"}
        back="/customers"
        action={
          <button
            aria-label="Edit school"
            className="mt-1 rounded-lg p-2 text-[var(--ink-2)] hover:bg-[var(--sunken)]"
            onClick={() => setEditing(true)}
          >
            <Pencil size={18} />
          </button>
        }
      />

      {/* The two numbers that matter about a customer: what they're worth, and
          what they still owe. */}
      <section className="border-y border-[var(--rule)] px-4 py-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="eyebrow">Lifetime purchases</p>
            <p className="figure mt-1 text-[2rem] leading-none">{formatMoney(o.revenue)}</p>
          </div>
          <div className="text-right">
            <p className="eyebrow">Outstanding</p>
            <p
              className="figure mt-1 text-[1.5rem] leading-none"
              style={{ color: o.outstanding > 0.01 ? "var(--debit)" : "var(--credit)" }}
            >
              {formatMoney(Math.max(0, o.outstanding))}
            </p>
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          <button className="btn btn-ink flex-1" onClick={newInvoice}>
            <Plus size={17} /> New invoice
          </button>
          {c.phone && (
            <>
              <a className="btn btn-quiet px-3" href={`tel:${c.phone}`} aria-label="Call">
                <Phone size={17} />
              </a>
              <a
                className="btn btn-quiet px-3"
                href={`https://wa.me/${c.phone.replace(/[^\d]/g, "")}`}
                target="_blank"
                rel="noreferrer"
                aria-label="WhatsApp"
              >
                <MessageCircle size={17} />
              </a>
            </>
          )}
        </div>
      </section>

      <Section title="Overview">
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Orders" value={String(o.orders)} sub={`${o.qty} books`} />
          <Stat label="Average order" value={formatMoneyShort(o.avgOrder)} />
          <Stat label="Paid to date" value={formatMoneyShort(o.paid)} tone="credit" />
          <Stat
            label="Profit earned"
            value={formatMoneyShort(o.profit)}
            sub={o.revenue > 0 ? `${((o.profit / o.revenue) * 100).toFixed(1)}% margin` : undefined}
          />
          <Stat
            label="Last purchase"
            value={o.lastPurchase ? relativeDays(o.lastPurchase) : "never"}
            sub={o.lastPurchase ? formatDate(o.lastPurchase) : "No invoices yet"}
          />
          <Stat
            label="First purchase"
            value={o.firstPurchase ? formatDate(o.firstPurchase) : "—"}
          />
        </div>
        {c.notes && (
          <p className="card mt-2 px-3.5 py-3 text-sm whitespace-pre-wrap text-[var(--ink-2)]">
            {c.notes}
          </p>
        )}
      </Section>

      <div className="no-print sticky top-0 z-20 border-y border-[var(--rule)] bg-[var(--paper)]/95 px-4 py-2 backdrop-blur">
        <div className="segment no-scrollbar w-full overflow-x-auto" role="tablist">
          {([
            ["history", `Invoices ${data.history.length}`],
            ["debts", `Owing ${data.debts.length}`],
            ["books", "Books"],
            ["payments", "Payments"],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              data-on={tab === key}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 py-3">
        {tab === "history" &&
          (data.history.length === 0 ? (
            <Empty
              title="No invoices yet"
              hint="Write one and this record fills itself in."
              action={
                <button className="btn btn-ink" onClick={newInvoice}>
                  <Plus size={17} /> New invoice
                </button>
              }
            />
          ) : (
            <ul className="card ruled overflow-hidden">
              {data.history.map((i) => (
                <li key={i.id}>
                  <Link href={`/invoices/${i.id}`} className="flex items-center gap-3 px-3.5 py-3 hover:bg-[var(--sunken)]">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="figure text-sm font-semibold">
                          {invoiceNumberLabel(i.number)}
                        </span>
                        <StatusPill payStatus={i.payStatus} status={i.status} />
                      </div>
                      <p className="mt-0.5 truncate text-xs text-[var(--ink-3)]">
                        {formatDate(i.date)} · {i.totals.qty} books ·{" "}
                        {i.lines
                          .slice(0, 2)
                          .map((l) => l.name)
                          .join(", ")}
                        {i.lines.length > 2 ? ` +${i.lines.length - 2}` : ""}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <Money value={i.totals.total} />
                      {i.balance > 0.01 && i.status === "open" && (
                        <div className="text-xs text-[var(--debit)]">{formatMoney(i.balance)} owing</div>
                      )}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          ))}

        {tab === "debts" &&
          (data.debts.length === 0 ? (
            <Empty title="Nothing owing" hint="Every invoice for this school is settled." />
          ) : (
            <ul className="card ruled overflow-hidden">
              {data.debts.map((d) => (
                <li key={d.invoiceId}>
                  <Link href={`/invoices/${d.invoiceId}`} className="flex items-center gap-3 px-3.5 py-3 hover:bg-[var(--sunken)]">
                    <div className="min-w-0 flex-1">
                      <span className="figure text-sm font-semibold">
                        {invoiceNumberLabel(d.number)}
                      </span>
                      <p className="text-xs text-[var(--ink-3)]">
                        {formatDate(d.date)} · {d.ageDays} days old
                      </p>
                      <p className="figure mt-0.5 text-xs text-[var(--ink-2)]">
                        {formatMoney(d.paid)} paid of {formatMoney(d.total)}
                      </p>
                    </div>
                    <Money value={d.balance} tone="debit" />
                  </Link>
                </li>
              ))}
            </ul>
          ))}

        {tab === "books" && (
          <div className="card px-3.5 py-3.5">
            <RankBars
              emptyLabel="No books bought yet."
              rows={data.favourites.map((f) => ({
                key: f.name,
                label: f.name,
                value: f.qty,
                display: `${f.qty} sold`,
                sub: formatMoneyShort(f.revenue),
              }))}
            />
          </div>
        )}

        {tab === "payments" &&
          (data.payments.length === 0 ? (
            <Empty title="No payments recorded" hint="Payments show up here as you record them on invoices." />
          ) : (
            <ul className="card ruled overflow-hidden">
              {data.payments.map((p) => (
                <li key={`${p.invoiceId}-${p.id}`} className="flex items-center gap-3 px-3.5 py-2.5">
                  <div className="min-w-0 flex-1">
                    <span className="figure text-sm">{formatDate(p.date)}</span>
                    <p className="text-xs text-[var(--ink-3)]">
                      {p.method} · {invoiceNumberLabel(p.invoiceNumber)}
                      {p.note ? ` · ${p.note}` : ""}
                    </p>
                  </div>
                  <Money value={p.amount} tone="credit" className="text-sm" />
                </li>
              ))}
            </ul>
          ))}
      </div>

      <Sheet open={editing} title="Edit school" onClose={() => setEditing(false)}>
        <EditCustomerForm
          profile={data}
          onDone={() => {
            setEditing(false);
            load();
          }}
          onDeleted={() => router.push("/customers")}
        />
      </Sheet>
    </main>
  );
}

function EditCustomerForm({
  profile,
  onDone,
  onDeleted,
}: {
  profile: CustomerProfile;
  onDone: () => void;
  onDeleted: () => void;
}) {
  const c = profile.customer;
  const [form, setForm] = useState({
    name: c.name,
    phone: c.phone,
    address: c.address,
    notes: c.notes,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function run(fn: () => Promise<unknown>, after: () => void) {
    setSaving(true);
    setError("");
    try {
      await fn();
      after();
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => updateCustomer(c.id, form), onDone);
      }}
    >
      {error && <ErrorNote>{error}</ErrorNote>}

      <Labelled label="School / customer name" hint="Correcting this also corrects it on their past invoices.">
        <input
          className="field mt-1"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          required
        />
      </Labelled>
      <Labelled label="Phone">
        <input
          className="field mt-1"
          type="tel"
          value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
        />
      </Labelled>
      <Labelled label="Address">
        <input
          className="field mt-1"
          value={form.address}
          onChange={(e) => setForm({ ...form, address: e.target.value })}
        />
      </Labelled>
      <Labelled label="Notes">
        <textarea
          className="field mt-1"
          rows={3}
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
        />
      </Labelled>

      <button className="btn btn-ink w-full" disabled={saving}>
        {saving ? "Saving…" : "Save changes"}
      </button>

      <div className="flex gap-2 border-t border-[var(--rule)] pt-3">
        <button
          type="button"
          className="btn btn-quiet flex-1"
          disabled={saving}
          onClick={() =>
            void run(
              () => (c.archived ? updateCustomer(c.id, { archived: false }) : archiveCustomer(c.id)),
              onDone
            )
          }
        >
          {c.archived ? "Unarchive" : "Archive"}
        </button>
        <button
          type="button"
          className="btn btn-danger flex-1"
          disabled={saving}
          onClick={() => void run(() => deleteCustomer(c.id), onDeleted)}
        >
          Delete
        </button>
      </div>
      <p className="text-xs text-[var(--ink-3)]">
        Deleting is refused while they still have invoices — archive them instead.
      </p>
    </form>
  );
}
