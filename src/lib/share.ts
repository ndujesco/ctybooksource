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

/** The invoice as a WhatsApp message. Asterisks are WhatsApp's bold. */
export function buildShareText(
  invoice: Invoice,
  business: Business,
  toggles: HeaderToggles
): string {
  const out: string[] = [];

  if (toggles.name && business.name) out.push(`*${business.name}*`);
  const contact = [
    toggles.phone ? business.phone : "",
    toggles.email ? business.email : "",
    toggles.address ? business.address : "",
  ].filter(Boolean);
  out.push(...contact);

  out.push("");
  out.push(`*${invoiceNumberLabel(invoice.number)}*  ·  ${formatDate(invoice.date)}`);
  if (invoice.customerName) out.push(`Billed to: ${invoice.customerName}`);
  out.push("--------------------------------");

  for (const l of invoice.lines) {
    out.push(`${l.qty} x ${lineName(l)}`);
    out.push(`     ${formatMoney(l.unitPrice)} = ${formatMoney(lineTotal(l))}`);
  }

  out.push("--------------------------------");
  if (invoice.totals.discount > 0) {
    out.push(`Subtotal: ${formatMoney(invoice.totals.subtotal)}`);
    out.push(`Discount ${invoice.discountPercent}%: -${formatMoney(invoice.totals.discount)}`);
  }
  out.push(`*TOTAL: ${formatMoney(invoice.totals.total)}*`);
  out.push(`Paid: ${formatMoney(invoice.amountPaid)}`);
  if (invoice.balance > 0.01) {
    out.push(`*Balance: ${formatMoney(invoice.balance)}*`);
  } else {
    out.push(`Status: ${PAY_STATUS_LABEL[invoice.payStatus]}`);
  }
  if (invoice.notes) {
    out.push("");
    out.push(invoice.notes);
  }
  return out.join("\n");
}

export function whatsappUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

export function mailtoUrl(subject: string, text: string): string {
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
}

/** Save a blob to the device. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick — Safari needs the URL alive when the click lands.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Hand a file to the OS share sheet (WhatsApp, Mail, AirDrop…), falling back to
 * a plain download wherever that isn't available.
 *
 * The share call is raced against a timeout. Building the file takes an await,
 * which spends the click's user activation — after that `navigator.share()` can
 * reject, and in some browsers it simply never settles. Either way the file
 * still has to reach the user, so a stuck share becomes a download.
 */
export async function shareFile(
  blob: Blob,
  filename: string,
  text: string
): Promise<"shared" | "downloaded"> {
  const file = new File([blob], filename, { type: blob.type });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };

  if (nav.share && nav.canShare?.({ files: [file] })) {
    const outcome = await Promise.race([
      nav.share({ files: [file], text }).then(
        () => "shared" as const,
        // Dismissing the OS sheet is a choice, not a failure to work around.
        (e: Error) => (e?.name === "AbortError" ? ("shared" as const) : ("failed" as const))
      ),
      new Promise<"failed">((resolve) => setTimeout(() => resolve("failed"), 2500)),
    ]);
    if (outcome === "shared") return "shared";
  }

  downloadBlob(blob, filename);
  return "downloaded";
}
