/**
 * End-to-end check in a real browser: walk every screen, exercise the export
 * paths, and report any console error or failed request.
 *
 *   node scripts/verify.mjs [baseUrl]
 */
import puppeteer from "puppeteer-core";

const BASE = process.argv[2] || "http://localhost:3000";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--hide-scrollbars"],
});
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

const problems = [];
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text().slice(0, 200)}`));
page.on("response", (r) => {
  if (r.status() >= 400) problems.push(`http ${r.status()}: ${r.url().replace(BASE, "")}`);
});

// Record what the export buttons would hand to the device.
await page.evaluateOnNewDocument(() => {
  window.__saved = [];
  const real = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (blob) => {
    if (blob instanceof Blob) window.__saved.push({ type: blob.type, size: blob.size });
    return real(blob);
  };
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const go = async (path, settle = 2500) => {
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle2" });
  await wait(settle);
};

const [invoice] = await fetch(`${BASE}/api/invoices?limit=1`).then((r) => r.json());
const [customer] = await fetch(`${BASE}/api/customers`).then((r) => r.json());

const screens = [
  ["ledger", "/"],
  ["invoices", "/invoices"],
  ["invoice editor", `/invoices/${invoice.id}`],
  ["trash", "/invoices/trash"],
  ["schools", "/customers"],
  ["school record", `/customers/${customer.id}`],
  ["books", "/books"],
  ["reports · sales", "/reports?tab=sales"],
  ["reports · books", "/reports?tab=books"],
  ["reports · schools", "/reports?tab=schools"],
  ["reports · debt", "/reports?tab=debt"],
  ["reports · profit", "/reports?tab=profit"],
  ["settings", "/settings"],
];

for (const [name, path] of screens) {
  const before = problems.length;
  await go(path);
  const empty = await page.evaluate(() => document.body.innerText.trim().length < 40);
  console.log(
    `${problems.length === before && !empty ? "ok  " : "FAIL"} ${name.padEnd(18)} ${empty ? "(page looks empty)" : ""}`
  );
}

// Exports
await go(`/invoices/${invoice.id}`);
await page.click('button[aria-label="Share invoice"]');
await wait(1500);

const clickIn = (label) =>
  page.evaluate((t) => {
    const b = [...document.querySelectorAll('[role="dialog"] button')].find((x) =>
      x.textContent.trim().startsWith(t)
    );
    if (b) b.click();
    return !!b;
  }, label);

await clickIn("PDF");
await wait(7000);
await clickIn("Save to phone");
await wait(7000);

const saved = await page.evaluate(() => window.__saved);
const pdf = saved.find((s) => s.type === "application/pdf");
const png = saved.find((s) => s.type === "image/png");
console.log(`${pdf ? "ok  " : "FAIL"} PDF export       ${pdf ? `${pdf.size} bytes` : "no blob produced"}`);
console.log(`${png ? "ok  " : "FAIL"} PNG export       ${png ? `${png.size} bytes` : "no blob produced"}`);

console.log(
  problems.length ? `\n${problems.length} problems:\n - ${[...new Set(problems)].join("\n - ")}` : "\nNo console errors or failed requests."
);

await browser.close();
