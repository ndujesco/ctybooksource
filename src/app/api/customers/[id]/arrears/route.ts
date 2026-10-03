import { NextResponse } from "next/server";
import { arrearsFor } from "@/lib/arrears";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/customers/:id/arrears?exclude=<invoiceId>
 *
 * What this school still owes on their other open invoices. The editor asks
 * for it so it can offer to carry the balance forward — the offer is only
 * worth making when there is actually something to carry.
 */
export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  const exclude = new URL(req.url).searchParams.get("exclude");
  return NextResponse.json(await arrearsFor(id, exclude));
}
