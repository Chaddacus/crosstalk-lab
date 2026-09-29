// Dev helper: screenshot the running app. usage: node scripts/shoot.mjs <outDir> [url]
import { chromium } from "@playwright/test";
const out = process.argv[2];
const url = process.argv[3] ?? "http://127.0.0.1:4173/";
const browser = await chromium.launch({ channel: "chrome" });
const logs = [];
async function shot(name, w, h, fn, mobile = false) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
  const page = await ctx.newPage();
  page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && logs.push(`[${name}] ${m.type()}: ${m.text()}`));
  page.on("pageerror", (e) => logs.push(`[${name}] pageerror: ${e.message}`));
  await page.goto(url);
  await page.waitForSelector('[data-testid="run-status"][data-running="0"][data-done="183"]', { timeout: 20000 });
  await page.waitForTimeout(2200);
  if (fn) await fn(page);
  await page.screenshot({ path: `${out}/${name}.png` });
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  logs.push(`[${name}] scrollWidth ${sw}`);
  await ctx.close();
}
await shot("hero-1440", 1440, 900);
await shot("hover-1440", 1440, 900, async (page) => {
  const c = page.locator('[data-testid="chord"][data-hub="0"][data-state="error"]').first();
  const box = await c.boundingBox();
  const pair = await c.getAttribute("data-pair");
  logs.push("hover pair " + pair);
  await page.locator(`[data-testid="pairs-item"][data-pair="${pair}"]`).hover().catch(() => {});
  await page.waitForTimeout(400);
});
await shot("mobile-390", 390, 844, null, true);
await browser.close();
console.log(logs.join("\n"));
