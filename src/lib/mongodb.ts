import { MongoClient, type Db, type Collection } from "mongodb";
import type { BookDoc, CustomerDoc, InvoiceDoc } from "@/lib/types";

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || "bookDB";

if (!uri) {
  throw new Error("MONGODB_URI is not set. Add it to .env.local");
}

// Cache the client across hot reloads in development to avoid exhausting
// connections.
let clientPromise: Promise<MongoClient>;

declare global {
  var _princebooksMongo: Promise<MongoClient> | undefined;
}

if (process.env.NODE_ENV === "development") {
  if (!global._princebooksMongo) {
    global._princebooksMongo = new MongoClient(uri).connect();
  }
  clientPromise = global._princebooksMongo;
} else {
  clientPromise = new MongoClient(uri).connect();
}

export async function getDb(): Promise<Db> {
  const client = await clientPromise;
  return client.db(dbName);
}

export async function invoices(): Promise<Collection<InvoiceDoc>> {
  return (await getDb()).collection<InvoiceDoc>("invoices");
}

export async function customers(): Promise<Collection<CustomerDoc>> {
  return (await getDb()).collection<CustomerDoc>("customers");
}

export async function books(): Promise<Collection<BookDoc>> {
  return (await getDb()).collection<BookDoc>("books");
}

type CounterDoc = { _id: string; seq: number };

/**
 * Atomically hand out the next invoice number. Uses a single counter doc so
 * two tills can't ever mint the same number.
 */
export async function nextInvoiceNumber(): Promise<number> {
  const db = await getDb();
  const col = db.collection<CounterDoc>("counters");
  const doc = await col.findOneAndUpdate(
    { _id: "invoiceNumber" },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: "after" }
  );
  return doc?.seq ?? 1;
}

/** Indexes for the queries the list screens and analytics actually run. */
let indexesReady: Promise<void> | undefined;

export function ensureIndexes(): Promise<void> {
  if (!indexesReady) {
    indexesReady = (async () => {
      const db = await getDb();
      await Promise.all([
        db.collection("invoices").createIndex({ deleted: 1, date: -1 }),
        db.collection("invoices").createIndex({ number: -1 }),
        db.collection("invoices").createIndex({ customerId: 1, date: -1 }),
        db.collection("invoices").createIndex({ customerName: 1 }),
        db.collection("customers").createIndex({ name: 1 }),
        db.collection("books").createIndex({ shortName: 1 }),
      ]);
    })().catch(() => {
      // Index creation is best-effort — never block a request on it.
      indexesReady = undefined;
    });
  }
  return indexesReady;
}
