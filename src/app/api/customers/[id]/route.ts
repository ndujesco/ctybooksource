import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { customers, invoices } from "@/lib/mongodb";
import { toCustomer, str } from "@/lib/serialize";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function oid(id: string): ObjectId | null {
  return ObjectId.isValid(id) ? new ObjectId(id) : null;
}

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const _id = oid(id);
  if (!_id) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const col = await customers();
  const doc = await col.findOne({ _id });
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(toCustomer(doc));
}

// PATCH /api/customers/:id
export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const _id = oid(id);
  if (!_id) return NextResponse.json({ error: "bad id" }, { status: 400 });

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "bad body" }, { status: 400 });
  }

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof body.name === "string") set.name = str(body.name, 200).trim();
  if (typeof body.phone === "string") set.phone = str(body.phone, 80).trim();
  if (typeof body.address === "string") set.address = str(body.address, 300).trim();
  if (typeof body.notes === "string") set.notes = str(body.notes, 1000);
  if (typeof body.archived === "boolean") set.archived = body.archived;

  const col = await customers();
  const doc = await col.findOneAndUpdate({ _id }, { $set: set }, { returnDocument: "after" });
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Push the corrected details onto this customer's existing invoices. Editing
  // a customer here is a correction ("ABC Schl" -> "ABC School"), so searching
  // invoices by school name should find the old ones under the new spelling.
  const touchesSnapshot =
    set.name !== undefined || set.phone !== undefined || set.address !== undefined;
  if (touchesSnapshot) {
    const inv = await invoices();
    await inv.updateMany(
      { customerId: id },
      {
        $set: {
          customerName: doc.name,
          customerPhone: doc.phone,
          customerAddress: doc.address,
        },
      }
    );
  }

  return NextResponse.json(toCustomer(doc));
}

// DELETE /api/customers/:id             -> archive
// DELETE /api/customers/:id?permanent=1 -> remove (refused if they have invoices)
export async function DELETE(req: Request, { params }: Ctx) {
  const { id } = await params;
  const _id = oid(id);
  if (!_id) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const col = await customers();
  const permanent = new URL(req.url).searchParams.get("permanent") === "1";

  if (permanent) {
    const inv = await invoices();
    const used = await inv.countDocuments({ customerId: id }, { limit: 1 });
    if (used > 0) {
      return NextResponse.json(
        { error: "This customer has invoices. Archive them instead." },
        { status: 409 }
      );
    }
    await col.deleteOne({ _id });
  } else {
    await col.updateOne({ _id }, { $set: { archived: true, updatedAt: new Date() } });
  }
  return NextResponse.json({ ok: true });
}
