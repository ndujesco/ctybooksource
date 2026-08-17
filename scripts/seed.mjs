/**
 * Seed the app with a plausible term's worth of trade, through the real API —
 * so it exercises the same validation, numbering and recompute the app uses.
 *
 *   node scripts/seed.mjs [baseUrl]
 *
 * Safe to re-run: it always adds, never deletes.
 */

const BASE = process.argv[2] || "http://localhost:3000";

const api = async (path, method = "GET", body) => {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
  return res.json();
};

const BOOKS = [
  ["Oxford Maths 5", "Oxford Mathematics for Primary Schools Book 5", "Oxford", "Mathematics", 1400, 2000],
  ["Oxford Maths 6", "Oxford Mathematics for Primary Schools Book 6", "Oxford", "Mathematics", 1450, 2100],
  ["Cambridge Eng 4", "Cambridge Primary English Learner's Book 4", "Cambridge", "English", 1800, 2600],
  ["Cambridge Sci 3", "Cambridge Primary Science Learner's Book 3", "Cambridge", "Science", 1750, 2500],
  ["Lantern Basic Sci 2", "Lantern Basic Science and Technology for JSS 2", "Lantern", "Science", 900, 1400],
  ["Learn Africa Govt", "Learn Africa Comprehensive Government for SSS", "Learn Africa", "Government", 1200, 1900],
  ["Macmillan Yoruba 1", "Macmillan Ede Yoruba Fun Awon Ile Iwe Alakobere 1", "Macmillan", "Yoruba", 700, 1150],
  ["Longman Eng Primary 3", "Longman Brilliant English for Primary Schools Book 3", "Longman", "English", 1100, 1700],
  ["UP Literature SSS", "University Press Literature-in-English for SSS", "University Press", "Literature", 1600, 2400],
  ["Evans CRS 5", "Evans Christian Religious Studies for Primary 5", "Evans", "CRS", 650, 1000],
  ["Spectrum Agric JSS", "Spectrum Agricultural Science for Junior Secondary", "Spectrum", "Agriculture", 850, 1300],
  ["Melrose Quantitative", "Melrose Quantitative Reasoning for Primary Schools", "Melrose", "Reasoning", 500, 900],
];

const SCHOOLS = [
  ["ABC International School", "08031234567", "12 Herbert Macaulay Way, Yaba, Lagos"],
  ["XYZ Model College", "08022223333", "45 Ikorodu Road, Palmgrove, Lagos"],
  ["Emmanuel Bookshop", "07044445555", "Shop 12, Tejuosho Market, Yaba"],
  ["Greenfield Academy", "08055556666", "3 Bode Thomas Street, Surulere"],
  ["St. Mary's Primary School", "08066667777", "Church Road, Mushin, Lagos"],
  ["Divine Grace Schools", "09077778888", "18 Agege Motor Road, Oshodi"],
  ["Crescent Nursery & Primary", "08088889999", "7 Adeniran Ogunsanya, Surulere"],
];

const METHODS = ["Cash", "Transfer", "POS", "Cheque"];

// Deterministic PRNG so a re-seed produces a comparable shape of business.
let seed = 20260816;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const between = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

const ymd = (d) => d.toISOString().slice(0, 10);

async function main() {
  console.log(`Seeding ${BASE} …`);

  const books = [];
  for (const [name, , publisher, category, costPrice, sellingPrice] of BOOKS) {
    books.push(await api("/books", "POST", { name, publisher, category, costPrice, sellingPrice }));
  }
  console.log(`  ${books.length} books`);

  const customers = [];
  for (const [name, phone, address] of SCHOOLS) {
    customers.push(await api("/customers", "POST", { name, phone, address, notes: "" }));
  }
  console.log(`  ${customers.length} schools`);

  const now = new Date();
  let invoiceCount = 0;

  // ~7 months of trade, busier in the run-up to a new term.
  for (let daysBack = 210; daysBack >= 0; daysBack--) {
    const date = new Date(now);
    date.setDate(date.getDate() - daysBack);
    const month = date.getMonth();
    const termRush = month === 8 || month === 0 || month === 3; // Sep / Jan / Apr
    const perDay = rnd() < (termRush ? 0.75 : 0.35) ? between(1, termRush ? 3 : 2) : 0;

    for (let n = 0; n < perDay; n++) {
      const customer = pick(customers);
      const lineCount = between(1, 5);
      const chosen = new Set();
      const lines = [];

      for (let i = 0; i < lineCount; i++) {
        const book = pick(books);
        if (chosen.has(book.id)) continue;
        chosen.add(book.id);
        lines.push({
          id: `l${invoiceCount}-${i}`,
          bookId: book.id,
          name: book.name,
          publisher: book.publisher,
          category: book.category,
          qty: between(5, 120),
          unitPrice: book.sellingPrice,
          costPrice: book.costPrice,
        });
      }
      if (lines.length === 0) continue;

      const discountPercent = rnd() < 0.25 ? pick([2.5, 5, 7.5, 10]) : 0;
      const total = lines.reduce((s, l) => s + l.qty * l.unitPrice, 0) * (1 - discountPercent / 100);

      // Roughly: half settle on the spot, a quarter part-pay, a quarter don't pay.
      const roll = rnd();
      const payments = [];
      if (roll < 0.5) {
        payments.push({
          id: `p${invoiceCount}-1`,
          amount: Math.round(total),
          method: pick(METHODS),
          date: ymd(date),
          note: "",
        });
      } else if (roll < 0.78) {
        payments.push({
          id: `p${invoiceCount}-1`,
          amount: Math.round(total * (0.25 + rnd() * 0.5)),
          method: pick(METHODS),
          date: ymd(date),
          note: "Part payment",
        });
      }

      const created = await api("/invoices", "POST", {
        customerId: customer.id,
        customerName: customer.name,
        customerPhone: customer.phone,
        customerAddress: customer.address,
        date: ymd(date),
        lines,
        discountPercent,
        payments,
        notes: rnd() < 0.2 ? "Delivery arranged for the following week." : "",
      });

      // POST creates it as a draft; the PATCH is what promotes it to a real sale.
      await api(`/invoices/${created.id}`, "PATCH", { lines, payments, discountPercent });
      invoiceCount++;
    }
  }

  console.log(`  ${invoiceCount} invoices`);
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
