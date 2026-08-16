/**
 * Drive the core job through the UI, the way it's actually done:
 * new invoice → pick a school → add books → switch a line to its full title →
 * record a part payment → confirm the saved document matches the screen.
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
const clickText = (text, scope = "body") =>
  page.evaluate(
    (t, sc) => {
      const el = [...document.querySelectorAll(`${sc} button, ${sc} a`)].find((x) =>
        x.textContent.trim().startsWith(t)
      );
      if (el) el.click();
      return !!el;
    },
    text,
    scope
  );

const step = (label, ok, extra = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label.padEnd(34)} ${extra}`);
  if (!ok) process.exitCode = 1;
};

await page.goto(BASE, { waitUntil: "networkidle2" });
await wait(2500);

step("open ledger", await clickText("New invoice"));
await page.waitForFunction(() => location.pathname.startsWith("/invoices/"), { timeout: 20000 });
await wait(2500);
const invoiceId = page.url().split("/").pop();

// School
step("open school picker", await clickText("Choose school"));
await wait(1800);
step("pick a school", await clickText("ABC", '[role="dialog"]'));
await wait(1500);

// Two books
for (const n of [1, 2]) {
  await clickText("Add book");
  await wait(1500);
  const picked = await page.evaluate(() => {
    const b = [...document.querySelectorAll('[role="dialog"] li button')][0];
    if (b) b.click();
    return !!b;
  });
  step(`add book ${n}`, picked);
  await wait(1200);
}

// Quantity on the first line
await page.evaluate(() => {
  const qty = document.querySelector('input[type="number"][inputmode="numeric"]');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  setter.call(qty, "40");
  qty.dispatchEvent(new Event("input", { bubbles: true }));
});
await wait(1500);

// Switch the first line to its full title
const switched = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button[aria-pressed]')].find(
    (b) => b.textContent.trim() === "Full"
  );
  if (btn) btn.click();
  return !!btn;
});
step("switch a line to full title", switched);
await wait(1500);

// Part payment
step("open payment form", await clickText("Record a payment"));
await wait(900);
await page.evaluate(() => {
  const amount = document.querySelector('input[type="number"][step="0.01"]');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  setter.call(amount, "5000");
  amount.dispatchEvent(new Event("input", { bubbles: true }));
});
await wait(400);
step("add the payment", await clickText("Add payment"));
await wait(2500);

// What the screen says
const onScreen = await page.evaluate(() => {
  const text = document.body.innerText;
  const grab = (label) => {
    const i = text.indexOf(label);
    return i === -1 ? null : text.slice(i, i + 60).split("\n")[1]?.trim() ?? null;
  };
  return { balanceLabel: /Balance owing|Settled|Overpaid/.exec(text)?.[0] ?? null, grandTotal: grab("Grand total") };
});

// What the server stored
const saved = await fetch(`${BASE}/api/invoices/${invoiceId}`).then((r) => r.json());
step("invoice promoted from draft", saved.status === "open", `status=${saved.status}`);
step("customer saved", !!saved.customerName, saved.customerName);
step("lines saved", saved.lines.length === 2, `${saved.lines.length} lines`);
step("quantity saved", saved.lines[0].qty === 40, `qty=${saved.lines[0].qty}`);
step("full-title mode saved", saved.lines[0].nameMode === "full", saved.lines[0].nameMode);
step("payment saved", saved.amountPaid === 5000, `paid=${saved.amountPaid}`);
step(
  "server totals agree with the lines",
  Math.abs(saved.totals.total - saved.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0)) < 0.01,
  `total=${saved.totals.total}`
);
step("balance derived", Math.abs(saved.balance - (saved.totals.total - 5000)) < 0.01, `balance=${saved.balance}`);
step("pay status derived", saved.payStatus === "partial", saved.payStatus);
step("screen shows a balance", onScreen.balanceLabel === "Balance owing", String(onScreen.balanceLabel));

// Clean up the invoice this test created.
await fetch(`${BASE}/api/invoices/${invoiceId}?permanent=1`, { method: "DELETE" });

console.log(problems.length ? `\nproblems:\n - ${[...new Set(problems)].join("\n - ")}` : "\nNo console errors.");
await browser.close();
