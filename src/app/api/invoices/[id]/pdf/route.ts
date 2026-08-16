import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { invoices } from "@/lib/mongodb";
import { toInvoice, str } from "@/lib/serialize";
import { renderInvoicePdf, invoiceFileName } from "@/lib/invoice-pdf";
import { DEFAULT_BUSINESS, DEFAULT_TOGGLES, type Business, type HeaderToggles } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/invoices/:id/pdf — render the invoice as a PDF.
 *
 * The letterhead (business details and which of them to show) lives in the
 * browser's localStorage, so the client posts it along with the request.
 */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }

  let body: { business?: Partial<Business>; toggles?: Partial<HeaderToggles> } = {};
  try {
    body = await req.json();
  } catch {
    /* letterhead is optional — fall back to defaults */
  }

  const col = await invoices();
  const doc = await col.findOne({ _id: new ObjectId(id) });
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });

  const invoice = toInvoice(doc);
  const business: Business = {
    name: str(body.business?.name, 200) || DEFAULT_BUSINESS.name,
    phone: str(body.business?.phone, 200),
    email: str(body.business?.email, 200),
    address: str(body.business?.address, 300),
  };
  const toggles: HeaderToggles = {
    name: body.toggles?.name ?? DEFAULT_TOGGLES.name,
    phone: body.toggles?.phone ?? DEFAULT_TOGGLES.phone,
    email: body.toggles?.email ?? DEFAULT_TOGGLES.email,
    address: body.toggles?.address ?? DEFAULT_TOGGLES.address,
  };

  const pdf = await renderInvoicePdf(invoice, business, toggles);
  const filename = invoiceFileName(invoice, "pdf");

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
