"use client";

import { useRef, useState } from "react";
import { FileDown, Image as ImageIcon, Mail, MessageCircle, Printer } from "lucide-react";
import Sheet from "@/components/Sheet";
import ScaledPreview from "@/components/ScaledPreview";
import InvoiceDocument from "@/components/InvoiceDocument";
import { fetchInvoicePdf } from "@/lib/client";
import { useBusiness, useHeaderToggles } from "@/lib/use-settings";
import { buildShareText, downloadBlob, mailtoUrl, shareFile, whatsappUrl } from "@/lib/share";
import { invoiceNumberLabel, type Invoice } from "@/lib/types";
import { ErrorNote } from "@/components/ui";

/**
 * One place to get the invoice out of the app: as a PDF, as an image, to the
 * printer, or as a WhatsApp message.
 */
export default function ShareSheet({
  open,
  invoice,
  onClose,
}: {
  open: boolean;
  invoice: Invoice;
  onClose: () => void;
}) {
  const docRef = useRef<HTMLDivElement>(null);
  const business = useBusiness();
  const toggles = useHeaderToggles();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  // Per-share header: edit the shop name that prints, or drop it entirely, just
  // for this send. The saved default on the Settings tab is left untouched.
  const [showName, setShowName] = useState(toggles.name);
  const [shopName, setShopName] = useState(business.name);
  const shareBusiness = { ...business, name: shopName };
  const shareToggles = { ...toggles, name: showName };

  const text = buildShareText(invoice, shareBusiness, shareToggles);
  const baseName = `${invoiceNumberLabel(invoice.number)}-${(invoice.customerName || "invoice")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")}`.toLowerCase();

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message || "That didn't work. Try again.");
    } finally {
      setBusy("");
    }
  }

  const savePdf = () =>
    run("pdf", async () => {
      const blob = await fetchInvoicePdf(invoice.id, { business: shareBusiness, toggles: shareToggles });
      await shareFile(blob, `${baseName}.pdf`, text);
    });

  const saveImage = () =>
    run("image", async () => {
      const node = docRef.current;
      if (!node) throw new Error("Nothing to capture yet.");
      const { toBlob } = await import("html-to-image");
      const blob = await toBlob(node, { pixelRatio: 2, backgroundColor: "#ffffff" });
      if (!blob) throw new Error("Couldn't render the image.");
      await shareFile(blob, `${baseName}.png`, text);
    });

  const saveImageDirect = () =>
    run("image-save", async () => {
      const node = docRef.current;
      if (!node) throw new Error("Nothing to capture yet.");
      const { toBlob } = await import("html-to-image");
      const blob = await toBlob(node, { pixelRatio: 2, backgroundColor: "#ffffff" });
      if (!blob) throw new Error("Couldn't render the image.");
      downloadBlob(blob, `${baseName}.png`);
    });

  return (
    <Sheet
      open={open}
      title={`Share ${invoiceNumberLabel(invoice.number)}`}
      onClose={onClose}
      footer={
        <div className="grid grid-cols-2 gap-2">
          <a
            className="btn btn-quiet"
            href={whatsappUrl(text)}
            target="_blank"
            rel="noreferrer"
            onClick={onClose}
          >
            <MessageCircle size={17} /> WhatsApp
          </a>
          <a className="btn btn-quiet" href={mailtoUrl(`Invoice ${invoiceNumberLabel(invoice.number)}`, text)}>
            <Mail size={17} /> Email
          </a>
        </div>
      }
    >
      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="grid grid-cols-2 gap-2">
        <button className="btn btn-ink" onClick={savePdf} disabled={!!busy}>
          <FileDown size={17} /> {busy === "pdf" ? "Building…" : "PDF"}
        </button>
        <button className="btn btn-quiet" onClick={saveImage} disabled={!!busy}>
          <ImageIcon size={17} /> {busy === "image" ? "Rendering…" : "Image"}
        </button>
        <button className="btn btn-quiet" onClick={saveImageDirect} disabled={!!busy}>
          <ImageIcon size={17} /> {busy === "image-save" ? "Saving…" : "Save to phone"}
        </button>
        <button className="btn btn-quiet" onClick={() => window.print()} disabled={!!busy}>
          <Printer size={17} /> Print
        </button>
      </div>

      <div className="mt-4 rounded-xl border border-[var(--rule)] p-3">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={showName}
            onChange={(e) => setShowName(e.target.checked)}
          />
          Show shop name on this invoice
        </label>
        {showName && (
          <input
            className="field mt-2"
            value={shopName}
            onChange={(e) => setShopName(e.target.value)}
            placeholder="Shop name"
            aria-label="Shop name"
          />
        )}
        <p className="mt-2 text-xs text-[var(--ink-3)]">
          Only affects this share — your saved default stays as it is.
        </p>
      </div>

      <p className="mt-3 mb-2 eyebrow">Preview</p>
      <div className="card overflow-hidden">
        <ScaledPreview width={680}>
          <InvoiceDocument ref={docRef} invoice={invoice} business={shareBusiness} toggles={shareToggles} />
        </ScaledPreview>
      </div>
    </Sheet>
  );
}
