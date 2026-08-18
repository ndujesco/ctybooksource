import { forwardRef } from "react";
import {
  formatMoney,
  invoiceNumberLabel,
  lineName,
  lineTotal,
  PAY_STATUS_LABEL,
  type Invoice,
} from "@/lib/types";
import { formatDate } from "@/lib/datetime";
import type { Business, HeaderToggles } from "@/lib/settings";

/* ---------------------------------------------------------------------------
   The document that leaves the building — printed, shared as an image, or
   saved as a PDF. Styles are inline on purpose: html-to-image and the print
   stylesheet both render this outside the app's own CSS context.
   ------------------------------------------------------------------------ */

const INK = "#16223a";
const DIM = "#5a6478";
const FAINT = "#8d95a5";
const RULE = "#e5e3da";
const GOLD = "#a8761f";
const CREDIT = "#157f4e";
const DEBIT = "#b3261e";
const MONO = "ui-monospace, 'IBM Plex Mono', 'SF Mono', Menlo, monospace";
const SANS = "'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif";
const SERIF = "Newsreader, Georgia, serif";

type Props = { invoice: Invoice; business: Business; toggles: HeaderToggles };

const InvoiceDocument = forwardRef<HTMLDivElement, Props>(function InvoiceDocument(
  { invoice, business, toggles },
  ref
) {
  const { totals } = invoice;
  const hasDiscount = totals.discount > 0;

  const contact: string[] = [];
  if (toggles.phone && business.phone) contact.push(business.phone);
  if (toggles.email && business.email) contact.push(business.email);

  const th: React.CSSProperties = {
    borderBottom: `1.5px solid ${INK}`,
    padding: "7px 8px",
    fontFamily: MONO,
    fontSize: 9.5,
    fontWeight: 600,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    color: DIM,
  };
  const td: React.CSSProperties = {
    borderBottom: `1px solid ${RULE}`,
    padding: "8px",
    fontSize: 13,
    verticalAlign: "top",
  };
  const figure: React.CSSProperties = { fontFamily: MONO, fontVariantNumeric: "tabular-nums" };

  return (
    <div
      ref={ref}
      style={{
        background: "#ffffff",
        color: INK,
        padding: "28px 24px",
        width: "100%",
        fontFamily: SANS,
        lineHeight: 1.45,
      }}
    >
      {/* Masthead */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
        <div style={{ minWidth: 0 }}>
          {toggles.name && business.name && (
            <div style={{ fontFamily: SERIF, fontSize: 24, fontWeight: 600, letterSpacing: "-0.015em" }}>
              {business.name}
            </div>
          )}
          {contact.length > 0 && (
            <div style={{ ...figure, fontSize: 11, color: DIM, marginTop: 3 }}>{contact.join("  ·  ")}</div>
          )}
          {toggles.address && business.address && (
            <div style={{ fontSize: 11, color: DIM, marginTop: 2, maxWidth: 280 }}>{business.address}</div>
          )}
        </div>
        <div style={{ textAlign: "right", flex: "none" }}>
          <div
            style={{
              fontFamily: MONO,
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "0.18em",
              color: GOLD,
            }}
          >
            INVOICE
          </div>
          <div style={{ ...figure, fontSize: 17, fontWeight: 600, marginTop: 2 }}>
            {invoiceNumberLabel(invoice.number)}
          </div>
          <div style={{ ...figure, fontSize: 11, color: DIM, marginTop: 2 }}>
            {formatDate(invoice.date)}
          </div>
        </div>
      </div>

      <div style={{ height: 2, background: INK, margin: "14px 0 0" }} />

      {/* Billed to */}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, marginTop: 14 }}>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontFamily: MONO,
              fontSize: 9.5,
              fontWeight: 600,
              letterSpacing: "0.13em",
              textTransform: "uppercase",
              color: FAINT,
            }}
          >
            Billed to
          </div>
          <div style={{ fontSize: 16, fontWeight: 600, marginTop: 2 }}>
            {invoice.customerName || "—"}
          </div>
          {invoice.customerAddress && (
            <div style={{ fontSize: 12, color: DIM, maxWidth: 300 }}>{invoice.customerAddress}</div>
          )}
          {invoice.customerPhone && (
            <div style={{ ...figure, fontSize: 12, color: DIM }}>{invoice.customerPhone}</div>
          )}
        </div>
        <div style={{ textAlign: "right", flex: "none" }}>
          <span
            style={{
              fontFamily: MONO,
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              padding: "3px 8px",
              borderRadius: 5,
              background:
                invoice.payStatus === "paid" ? "#e4f2ea"
                : invoice.payStatus === "partial" ? "#fbf0de"
                : "#fbeae8",
              color:
                invoice.payStatus === "paid" ? CREDIT
                : invoice.payStatus === "partial" ? "#b45309"
                : DEBIT,
            }}
          >
            {PAY_STATUS_LABEL[invoice.payStatus]}
          </span>
        </div>
      </div>

      {/* Items */}
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 16 }}>
        <thead>
          <tr>
            <th style={{ ...th, width: 26, textAlign: "left" }}>#</th>
            <th style={{ ...th, textAlign: "left" }}>Book</th>
            <th style={{ ...th, width: 40, textAlign: "right" }}>Qty</th>
            <th style={{ ...th, width: 88, textAlign: "right" }}>Price</th>
            <th style={{ ...th, width: 96, textAlign: "right" }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {invoice.lines.length === 0 && (
            <tr>
              <td style={{ ...td, color: FAINT }} colSpan={5}>
                No books on this invoice yet.
              </td>
            </tr>
          )}
          {invoice.lines.map((l, i) => (
            <tr key={l.id}>
              <td style={{ ...td, ...figure, color: FAINT, fontSize: 11 }}>{i + 1}</td>
              <td style={td}>
                <span style={{ fontWeight: 500 }}>{lineName(l)}</span>
              </td>
              <td style={{ ...td, ...figure, textAlign: "right" }}>{l.qty}</td>
              <td style={{ ...td, ...figure, textAlign: "right" }}>{formatMoney(l.unitPrice)}</td>
              <td style={{ ...td, ...figure, textAlign: "right", fontWeight: 600 }}>
                {formatMoney(lineTotal(l))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Totals */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
        <div style={{ minWidth: 250 }}>
          <Row label="Subtotal" value={formatMoney(totals.subtotal)} />
          {hasDiscount && (
            <Row
              label={`Discount ${trimPct(invoice.discountPercent)}%`}
              value={`− ${formatMoney(totals.discount)}`}
              color={DEBIT}
            />
          )}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              borderTop: `2px solid ${INK}`,
              paddingTop: 8,
              marginTop: 6,
            }}
          >
            <span style={{ fontWeight: 600, fontSize: 13 }}>Grand total</span>
            <span style={{ ...figure, fontWeight: 600, fontSize: 19 }}>
              {formatMoney(totals.total)}
            </span>
          </div>

          <div style={{ marginTop: 8 }}>
            <Row label="Amount paid" value={formatMoney(invoice.amountPaid)} color={CREDIT} bold />
            <Row
              label="Balance"
              value={formatMoney(Math.max(0, invoice.balance))}
              color={invoice.balance > 0.01 ? DEBIT : CREDIT}
              bold
            />
          </div>
        </div>
      </div>

      {/* Payments received */}
      {invoice.payments.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div
            style={{
              fontFamily: MONO,
              fontSize: 9.5,
              fontWeight: 600,
              letterSpacing: "0.13em",
              textTransform: "uppercase",
              color: FAINT,
              marginBottom: 4,
            }}
          >
            Payments received
          </div>
          {invoice.payments.map((p) => (
            <div
              key={p.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 12,
                borderBottom: `1px solid ${RULE}`,
                padding: "4px 0",
              }}
            >
              <span style={{ color: DIM }}>
                <span style={figure}>{formatDate(p.date)}</span> · {p.method}
                {p.note ? ` · ${p.note}` : ""}
              </span>
              <span style={{ ...figure, color: CREDIT }}>{formatMoney(p.amount)}</span>
            </div>
          ))}
        </div>
      )}

      {invoice.notes && (
        <div style={{ marginTop: 18 }}>
          <div
            style={{
              fontFamily: MONO,
              fontSize: 9.5,
              fontWeight: 600,
              letterSpacing: "0.13em",
              textTransform: "uppercase",
              color: FAINT,
            }}
          >
            Notes
          </div>
          <div style={{ fontSize: 12.5, color: DIM, whiteSpace: "pre-wrap", marginTop: 3 }}>
            {invoice.notes}
          </div>
        </div>
      )}

      <div style={{ marginTop: 22, borderTop: `1px solid ${RULE}`, paddingTop: 8 }}>
        <span style={{ ...figure, fontSize: 10.5, color: FAINT }}>
          {totals.qty} {totals.qty === 1 ? "book" : "books"}
        </span>
      </div>
    </div>
  );
});

function Row({
  label,
  value,
  color,
  bold,
}: {
  label: string;
  value: string;
  color?: string;
  bold?: boolean;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: 12.5 }}>
      <span style={{ color: DIM }}>{label}</span>
      <span
        style={{
          fontFamily: MONO,
          fontVariantNumeric: "tabular-nums",
          fontWeight: bold ? 600 : 500,
          color: color || INK,
        }}
      >
        {value}
      </span>
    </div>
  );
}

function trimPct(p: number): string {
  return Number.isInteger(p) ? String(p) : String(Math.round(p * 100) / 100);
}

export default InvoiceDocument;
