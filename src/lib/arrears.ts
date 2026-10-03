import { ObjectId } from "mongodb";
import { invoices } from "@/lib/mongodb";
import { round2 } from "@/lib/types";

/* ---------------------------------------------------------------------------
   Balance brought forward.

   What a school still owes on their *other* invoices. Recomputed on every write
   of an invoice that carries it forward, so the figure on the printed copy is
   never a stale snapshot of a debt that has since been paid.

   Only `open` invoices count — the same rule every report uses. A draft is
   half-typed and a cancelled invoice never happened, so neither is a debt.
   ------------------------------------------------------------------------ */

export type Arrears = {
  amount: number;
  invoiceCount: number;
  oldest: string | null; // yyyy-mm-dd of the earliest unpaid invoice
};

const NONE: Arrears = { amount: 0, invoiceCount: 0, oldest: null };

/**
 * @param customerId the school; a one-off customer with no record carries nothing
 * @param excludeId  the invoice being written — it can't bring itself forward
 */
export async function arrearsFor(
  customerId: string | null | undefined,
  excludeId?: string | ObjectId | null
): Promise<Arrears> {
  if (!customerId) return NONE;

  const col = await invoices();
  const exclude =
    excludeId instanceof ObjectId
      ? excludeId
      : typeof excludeId === "string" && ObjectId.isValid(excludeId)
      ? new ObjectId(excludeId)
      : null;

  const docs = await col
    .find(
      {
        customerId,
        deleted: { $ne: true },
        status: "open",
        balance: { $gt: 0.01 },
        ...(exclude ? { _id: { $ne: exclude } } : {}),
      },
      { projection: { balance: 1, date: 1 } }
    )
    .limit(500)
    .toArray();

  if (!docs.length) return NONE;

  return {
    amount: round2(docs.reduce((s, d) => s + (Number(d.balance) || 0), 0)),
    invoiceCount: docs.length,
    oldest: docs.reduce<string | null>(
      (min, d) => (!min || (d.date && d.date < min) ? d.date || min : min),
      null
    ),
  };
}
