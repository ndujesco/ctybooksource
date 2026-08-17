/**
 * Drive the AI import through the UI: open the sheet, paste an order, read it,
 * review the matched lines, create the invoice, and check what was saved.
 */
import puppeteer from "puppeteer-core";

const BASE = process.argv[2] || "http://localhost:3000";
const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--no-sandbox", "--hide-scrollbars"],
});
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

const problems = [];
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text().slice(0, 160)}`));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (label, ok, extra = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label.padEnd(34)} ${extra}`);
  if (!ok) process.exitCode = 1;
};
const clickText = (text) =>
  page.evaluate((t) => {
    const el = [...document.querySelectorAll("button")].find((x) => x.textContent.trim().startsWith(t));
    if (el) el.click();
    return !!el;
  }, text);

const ORDER = `Order for Divine Grace Schools, 18 Agege Motor Road Oshodi. 09077778888

35 oxford maths bk 5
20 cambridge eng 4
lantern basic sci 2 ......... 80
A Book We Do Not Stock  5`;

await page.goto(`${BASE}/invoices`, { waitUntil: "networkidle2" });
await page.waitForSelector('button[aria-label="Build an invoice from a list"]', { timeout: 60000 });

step("open the import sheet", await page.evaluate(() => {
  const b = document.querySelector('button[aria-label="Build an invoice from a list"]');
  if (b) b.click();
  return !!b;
}));
await page.waitForSelector('[role="dialog"] textarea', { timeout: 15000 });

await page.evaluate((text) => {
  const ta = document.querySelector('[role="dialog"] textarea');
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
  setter.call(ta, text);
  ta.dispatchEvent(new Event("input", { bubbles: true }));
}, ORDER);
await wait(400);

step("send it to be read", await clickText("Read the order"));
await page.waitForFunction(
  () => /books? found/.test(document.querySelector('[role="dialog"] h2')?.textContent ?? ""),
  { timeout: 120000 }
);
await wait(800);

const review = await page.evaluate(() => {
  const dialog = document.querySelector('[role="dialog"]');
  const nameInput = dialog.querySelector('input[aria-label="Customer name"]');
  return {
    title: dialog.querySelector("h2").textContent.trim(),
    customer: nameInput?.value ?? "",
    onFile: !![...dialog.querySelectorAll("span")].find((s) => s.textContent.trim() === "Already on file"),
    rows: dialog.querySelectorAll("li").length,
    unmatchedButtons: [...dialog.querySelectorAll("button")].filter((b) =>
      b.textContent.includes("Match to a book")
    ).length,
    warns: /aren't on your shelf|isn't on your shelf/.test(dialog.textContent),
  };
});

step("4 books in review", review.rows === 4, `${review.rows} rows — “${review.title}”`);
step("customer read from the text", review.customer === "Divine Grace Schools", review.customer);
step("customer recognised on file", review.onFile);
step("unknown book flagged", review.unmatchedButtons === 1, `${review.unmatchedButtons} unmatched`);
step("warns about untracked cost", review.warns);

step("create the invoice", await clickText("Create invoice"));
await page.waitForFunction(() => location.pathname.startsWith("/invoices/"), { timeout: 30000 });
await wait(2500);

const invoiceId = page.url().split("/").pop();
const saved = await fetch(`${BASE}/api/invoices/${invoiceId}`).then((r) => r.json());

step("invoice saved as a real sale", saved.status === "open", `status=${saved.status}`);
step("customer linked to their record", !!saved.customerId, saved.customerName);
step("all 4 lines saved", saved.lines.length === 4, `${saved.lines.length} lines`);
step(
  "matched lines carry a book id",
  saved.lines.filter((l) => l.bookId).length === 3,
  `${saved.lines.filter((l) => l.bookId).length}/4 linked to the shelf`
);
step(
  "matched lines carry a cost price",
  saved.lines.filter((l) => l.costPrice > 0).length === 3,
  `profit = ${saved.totals.profit}`
);
step(
  "quantities read correctly",
  JSON.stringify(saved.lines.map((l) => l.qty)) === JSON.stringify([35, 20, 80, 5]),
  saved.lines.map((l) => l.qty).join(", ")
);
step("totals computed", saved.totals.total > 0, `total=${saved.totals.total}`);

// Clean up the invoice this test created.
await fetch(`${BASE}/api/invoices/${invoiceId}?permanent=1`, { method: "DELETE" });

console.log(problems.length ? `\nproblems:\n - ${[...new Set(problems)].join("\n - ")}` : "\nNo console errors.");
await browser.close();
