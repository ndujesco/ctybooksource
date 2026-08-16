/** Screenshot every screen at phone size, for eyeballing the design. */
import puppeteer from "puppeteer-core";
import { mkdirSync } from "fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.argv[2] || "http://localhost:3000";
const OUT = "/tmp/pbshots";
mkdirSync(OUT, { recursive: true });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--hide-scrollbars"],
});

const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(`PAGEERROR ${e.message}`));

async function shot(name, path, prep) {
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle2" });
  await wait(900);
  if (prep) await prep();
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  console.log("ok:", name);
}

const firstInvoice = await fetch(`${BASE}/api/invoices?limit=1`).then((r) => r.json());
const firstCustomer = await fetch(`${BASE}/api/customers`).then((r) => r.json());

await shot("01-ledger", "/");
await shot("02-invoices", "/invoices");
await shot("03-invoice-editor", `/invoices/${firstInvoice[0].id}`);
await shot("04-share", `/invoices/${firstInvoice[0].id}`, async () => {
  await page.click('button[aria-label="Share invoice"]');
  await wait(1200);
});
await shot("05-customers", "/customers");
await shot("06-customer", `/customers/${firstCustomer[0].id}`);
await shot("07-books", "/books");
await shot("08-reports-sales", "/reports?tab=sales");
await shot("09-reports-books", "/reports?tab=books");
await shot("10-reports-debt", "/reports?tab=debt");
await shot("11-reports-profit", "/reports?tab=profit");
await shot("12-reports-schools", "/reports?tab=schools");
await shot("13-settings", "/settings");

if (errors.length) {
  console.log("\nCONSOLE ERRORS:");
  for (const e of [...new Set(errors)]) console.log(" -", e);
}

await browser.close();
console.log(`\nShots in ${OUT}`);
