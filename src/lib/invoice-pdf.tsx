import path from "node:path";
import {
  Document,
  Font,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from "@react-pdf/renderer";
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

/* A real, text-based PDF — selectable and searchable, not a screenshot.

   Rendered on the server: the browser build of @react-pdf/renderer never
   settles its `toBlob()` promise here, and keeping the renderer off the client
   also keeps about a megabyte of JavaScript off the phone. */

/* The PDF base-14 fonts (Helvetica, Courier, Times) only cover Latin-1, which
   has no ₦ — every figure on the invoice came out with a broken glyph. These
   are the same faces the app uses on screen, and all of them carry U+20A6. */
const fontFile = (name: string) => path.join(process.cwd(), "public", "fonts", name);

Font.register({
  family: "Plex Sans",
  fonts: [
    { src: fontFile("IBMPlexSans-Regular.ttf"), fontWeight: 400 },
    { src: fontFile("IBMPlexSans-SemiBold.ttf"), fontWeight: 600 },
  ],
});
Font.register({
  family: "Plex Mono",
  fonts: [
    { src: fontFile("IBMPlexMono-Regular.ttf"), fontWeight: 400 },
    { src: fontFile("IBMPlexMono-SemiBold.ttf"), fontWeight: 600 },
  ],
});
Font.register({
  family: "Newsreader",
  fonts: [{ src: fontFile("Newsreader-SemiBold.ttf"), fontWeight: 600 }],
});

// Long book titles must be allowed to break, or a single unbreakable word
// pushes the whole column out of the page.
Font.registerHyphenationCallback((word) => [word]);

const INK = "#16223a";
const DIM = "#5a6478";
const FAINT = "#8d95a5";
const RULE = "#e5e3da";
const GOLD = "#a8761f";
const CREDIT = "#157f4e";
const DEBIT = "#b3261e";

const s = StyleSheet.create({
  page: { paddingTop: 38, paddingBottom: 44, paddingHorizontal: 36, fontSize: 10, color: INK, fontFamily: "Plex Sans" },
  row: { flexDirection: "row" },
  between: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  company: { fontSize: 19, fontFamily: "Newsreader", fontWeight: 600 },
  meta: { fontSize: 8.5, color: DIM, fontFamily: "Plex Mono" },
  eyebrow: { fontSize: 7, letterSpacing: 1.4, color: FAINT, fontFamily: "Plex Mono", fontWeight: 600 },
  invoiceWord: { fontSize: 8, letterSpacing: 2, color: GOLD, fontFamily: "Plex Mono", fontWeight: 600 },
  number: { fontSize: 13, fontFamily: "Plex Mono", fontWeight: 600, marginTop: 2 },
  hr: { height: 1.5, backgroundColor: INK, marginTop: 11 },
  customer: { fontSize: 12, fontWeight: 600, marginTop: 2 },
  small: { fontSize: 9, color: DIM },
  th: { fontSize: 7, letterSpacing: 1, color: DIM, fontFamily: "Plex Mono", fontWeight: 600, paddingVertical: 5 },
  headRule: { borderBottomWidth: 1.2, borderBottomColor: INK },
  td: { fontSize: 9.5, paddingVertical: 6 },
  tdRule: { borderBottomWidth: 0.6, borderBottomColor: RULE },
  fig: { fontFamily: "Plex Mono" },
  figBold: { fontFamily: "Plex Mono", fontWeight: 600 },
  cNum: { width: 18 },
  cQty: { width: 34, textAlign: "right" },
  cPrice: { width: 74, textAlign: "right" },
  cAmount: { width: 82, textAlign: "right" },
  totalsBox: { width: 232, marginLeft: "auto", marginTop: 12 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2.5 },
  grand: { flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1.5, borderTopColor: INK, paddingTop: 6, marginTop: 4 },
  footer: { position: "absolute", bottom: 24, left: 36, right: 36, borderTopWidth: 0.6, borderTopColor: RULE, paddingTop: 6, fontSize: 8, color: FAINT, fontFamily: "Plex Mono" },
});

function InvoicePdf({ invoice, business, toggles }: { invoice: Invoice; business: Business; toggles: HeaderToggles }) {
  const { totals } = invoice;
  const contact = [
    toggles.phone ? business.phone : "",
    toggles.email ? business.email : "",
  ].filter(Boolean).join("   ");

  return (
    <Document title={`${invoiceNumberLabel(invoice.number)} — ${invoice.customerName || "Invoice"}`}>
      <Page size="A4" style={s.page}>
        <View style={s.between}>
          <View>
            {toggles.name && !!business.name && <Text style={s.company}>{business.name}</Text>}
            {!!contact && <Text style={[s.meta, { marginTop: 2 }]}>{contact}</Text>}
            {toggles.address && !!business.address && (
              <Text style={[s.small, { marginTop: 1, maxWidth: 240 }]}>{business.address}</Text>
            )}
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={s.invoiceWord}>INVOICE</Text>
            <Text style={s.number}>{invoiceNumberLabel(invoice.number)}</Text>
            <Text style={[s.meta, { marginTop: 1 }]}>{formatDate(invoice.date)}</Text>
          </View>
        </View>

        <View style={s.hr} />

        <View style={[s.between, { marginTop: 11 }]}>
          <View>
            <Text style={s.eyebrow}>BILLED TO</Text>
            <Text style={s.customer}>{invoice.customerName || "—"}</Text>
            {!!invoice.customerAddress && (
              <Text style={[s.small, { maxWidth: 250 }]}>{invoice.customerAddress}</Text>
            )}
            {!!invoice.customerPhone && <Text style={[s.small, s.fig]}>{invoice.customerPhone}</Text>}
          </View>
          <Text
            style={{
              fontSize: 8,
              fontFamily: "Plex Mono", fontWeight: 600,
              color: invoice.payStatus === "paid" ? CREDIT : invoice.payStatus === "partial" ? "#b45309" : DEBIT,
            }}
          >
            {PAY_STATUS_LABEL[invoice.payStatus].toUpperCase()}
          </Text>
        </View>

        {/* Items */}
        <View style={[s.row, s.headRule, { marginTop: 14 }]}>
          <Text style={[s.th, s.cNum]}>#</Text>
          <Text style={[s.th, { flex: 1 }]}>BOOK</Text>
          <Text style={[s.th, s.cQty]}>QTY</Text>
          <Text style={[s.th, s.cPrice]}>PRICE</Text>
          <Text style={[s.th, s.cAmount]}>AMOUNT</Text>
        </View>
        {invoice.lines.map((l, i) => (
          <View key={l.id} style={[s.row, s.tdRule]} wrap={false}>
            <Text style={[s.td, s.cNum, s.fig, { color: FAINT, fontSize: 8 }]}>{i + 1}</Text>
            <View style={[s.td, { flex: 1, paddingRight: 6 }]}>
              <Text>{lineName(l)}</Text>
              {!!l.publisher && <Text style={{ fontSize: 7.5, color: FAINT }}>{l.publisher}</Text>}
            </View>
            <Text style={[s.td, s.cQty, s.fig]}>{l.qty}</Text>
            <Text style={[s.td, s.cPrice, s.fig]}>{formatMoney(l.unitPrice)}</Text>
            <Text style={[s.td, s.cAmount, s.figBold]}>{formatMoney(lineTotal(l))}</Text>
          </View>
        ))}

        {/* Totals */}
        <View style={s.totalsBox}>
          <View style={s.totalRow}>
            <Text style={{ color: DIM }}>Subtotal</Text>
            <Text style={s.fig}>{formatMoney(totals.subtotal)}</Text>
          </View>
          {totals.discount > 0 && (
            <View style={s.totalRow}>
              <Text style={{ color: DIM }}>Discount {invoice.discountPercent}%</Text>
              <Text style={[s.fig, { color: DEBIT }]}>- {formatMoney(totals.discount)}</Text>
            </View>
          )}
          <View style={s.grand}>
            <Text style={{ fontWeight: 600, fontSize: 11 }}>Grand total</Text>
            <Text style={[s.figBold, { fontSize: 14 }]}>{formatMoney(totals.total)}</Text>
          </View>
          <View style={[s.totalRow, { marginTop: 6 }]}>
            <Text style={{ color: DIM }}>Amount paid</Text>
            <Text style={[s.figBold, { color: CREDIT }]}>{formatMoney(invoice.amountPaid)}</Text>
          </View>
          <View style={s.totalRow}>
            <Text style={{ color: DIM }}>Balance</Text>
            <Text style={[s.figBold, { color: invoice.balance > 0.01 ? DEBIT : CREDIT }]}>
              {formatMoney(Math.max(0, invoice.balance))}
            </Text>
          </View>
        </View>

        {invoice.payments.length > 0 && (
          <View style={{ marginTop: 16 }}>
            <Text style={s.eyebrow}>PAYMENTS RECEIVED</Text>
            {invoice.payments.map((p) => (
              <View key={p.id} style={[s.totalRow, s.tdRule, { paddingVertical: 3 }]}>
                <Text style={s.small}>
                  {formatDate(p.date)} · {p.method}
                  {p.note ? ` · ${p.note}` : ""}
                </Text>
                <Text style={[s.fig, { color: CREDIT, fontSize: 9.5 }]}>{formatMoney(p.amount)}</Text>
              </View>
            ))}
          </View>
        )}

        {!!invoice.notes && (
          <View style={{ marginTop: 16 }}>
            <Text style={s.eyebrow}>NOTES</Text>
            <Text style={[s.small, { marginTop: 2 }]}>{invoice.notes}</Text>
          </View>
        )}

        <Text style={s.footer} fixed>
          {totals.qty} {totals.qty === 1 ? "book" : "books"} · {invoiceNumberLabel(invoice.number)} ·
          Thank you for your business.
        </Text>
      </Page>
    </Document>
  );
}

export function invoiceFileName(invoice: Invoice, ext: string): string {
  const who = (invoice.customerName || "invoice")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
  return `${invoiceNumberLabel(invoice.number)}-${who}.${ext}`.toLowerCase();
}

export function renderInvoicePdf(
  invoice: Invoice,
  business: Business,
  toggles: HeaderToggles
): Promise<Buffer> {
  return renderToBuffer(<InvoicePdf invoice={invoice} business={business} toggles={toggles} />);
}
