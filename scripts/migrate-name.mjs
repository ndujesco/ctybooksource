/**
 * One-off: collapse books' shortName/fullName → a single `name`, and backfill
 * `name` on every invoice line, so data seeded before the single-name change
 * still displays. Safe to re-run.
 */
import { MongoClient } from "mongodb";
import { readFileSync } from "fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const client = new MongoClient(env.MONGODB_URI);
await client.connect();
const db = client.db(env.MONGODB_DB || "bookDB");

// Books: name = shortName (fallback fullName), then drop the old fields.
let bookCount = 0;
for (const b of await db.collection("books").find({ name: { $exists: false } }).toArray()) {
  const name = (b.shortName || b.fullName || "").trim();
  await db.collection("books").updateOne(
    { _id: b._id },
    { $set: { name }, $unset: { shortName: "", fullName: "" } }
  );
  bookCount++;
}

// Invoice lines: name = the one that was printing (full when nameMode was full).
let invCount = 0,
  lineCount = 0;
for (const inv of await db.collection("invoices").find({ "lines.name": { $exists: false } }).toArray()) {
  const lines = (inv.lines || []).map((l) => {
    if (l.name) return l;
    const name = (l.nameMode === "full" ? l.fullName : l.shortName) || l.shortName || l.fullName || "";
    lineCount++;
    const { shortName, fullName, nameMode, ...rest } = l;
    void shortName; void fullName; void nameMode;
    return { ...rest, name };
  });
  await db.collection("invoices").updateOne({ _id: inv._id }, { $set: { lines } });
  invCount++;
}

console.log(`Migrated ${bookCount} books, ${lineCount} lines across ${invCount} invoices.`);
await client.close();
