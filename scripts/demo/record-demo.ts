/**
 * Record the 60-second MOCK demo (SPEC §14) as screencast frames, with captions and a visible cursor.
 *   npx tsx scripts/demo/record-demo.ts            (builds nothing: run `npm run build` first)
 * Then assemble the frames: python scripts/demo/frames-to-gif.py   (needs Pillow)
 *
 * Every number in a caption is read from the page after the run. None is typed by hand.
 * The app runs in MOCK (the lexical stand-in, not Jev); the caption band says so for the whole clip.
 */
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { chromium, type Page } from "@playwright/test";

const PORT = 4473;
const W = 1440;
const APP_H = 900;
const BAND = 64;
const OUT = "test-results/demo-frames";
const demo = JSON.parse(readFileSync("tests/e2e/demo.json", "utf8")) as { pair: [string, string]; edits: Record<string, { what?: string; not_for?: string }> };
const demoKey = [...demo.pair].sort().join("|");

const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "preview", "--port", String(PORT), "--strictPort"], { stdio: "ignore" });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/`)).ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(200);
  }
  throw new Error("preview server did not start");
}

/** Overlay: a caption band under the app, a cursor that follows the mouse, a click ripple, title and end cards. */
const OVERLAY = `
(() => {
  const css = document.createElement('style');
  css.textContent = \`
    .h-dvh { height: ${APP_H}px !important; }
    #__band { position: fixed; left: 0; right: 0; top: ${APP_H}px; height: ${BAND}px; z-index: 2147483000; display: flex; align-items: center; gap: 18px;
      padding: 0 28px; background: #05070a; border-top: 1px solid #1f2833; font: 500 17px/1.3 "Inter Variable", system-ui, sans-serif; color: #e6edf3; }
    #__band .mock { flex: none; font: 600 11px/1 "JetBrains Mono Variable", monospace; letter-spacing: .08em; color: #f5b544; border: 1px solid rgb(245 181 68 / .45);
      background: rgb(245 181 68 / .1); padding: 7px 9px; border-radius: 6px; }
    #__band .cap { transition: opacity .35s; }
    #__cursor { position: fixed; left: 0; top: 0; z-index: 2147483600; pointer-events: none; transform: translate(-100px,-100px); }
    #__ripple { position: fixed; z-index: 2147483500; pointer-events: none; width: 34px; height: 34px; margin: -17px 0 0 -17px; border-radius: 50%;
      border: 2px solid #3dd6d0; opacity: 0; }
    #__card { position: fixed; inset: 0 0 ${BAND}px 0; z-index: 2147483100; display: flex; align-items: center; justify-content: center; pointer-events: none;
      transition: opacity .6s; }
    #__card .box { text-align: center; padding: 34px 48px; border-radius: 22px; background: rgb(7 9 12 / .86); border: 1px solid #2a3542;
      box-shadow: 0 40px 120px -20px rgb(0 0 0 / .9); backdrop-filter: blur(6px); }
    #__card h1 { margin: 0; font: 600 44px/1.1 "JetBrains Mono Variable", monospace; letter-spacing: .2em; color: #e6edf3; }
    #__card p { margin: 14px 0 0; font: 400 21px/1.45 "Inter Variable", system-ui, sans-serif; color: #8b98a5; }
    #__card .accent { color: #3dd6d0; }
    #__card .small { font: 500 13px/1.4 "JetBrains Mono Variable", monospace; color: #7a8898; margin-top: 18px; }
  \`;
  document.head.appendChild(css);
  const band = document.createElement('div'); band.id = '__band';
  band.innerHTML = '<span class="mock">MOCK · lexical stand-in, not Jev</span><span class="cap"></span>';
  document.body.appendChild(band);
  const cur = document.createElement('div'); cur.id = '__cursor';
  cur.innerHTML = '<svg width="22" height="26" viewBox="0 0 22 26"><path d="M2 2 L2 21 L7 16.5 L10.5 24 L14 22.5 L10.5 15 L17.5 15 Z" fill="#fff" stroke="#07090c" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  document.body.appendChild(cur);
  const rip = document.createElement('div'); rip.id = '__ripple'; document.body.appendChild(rip);
  addEventListener('mousemove', (e) => { cur.style.transform = 'translate(' + (e.clientX - 2) + 'px,' + (e.clientY - 2) + 'px)'; }, true);
  addEventListener('mousedown', (e) => {
    rip.style.left = e.clientX + 'px'; rip.style.top = e.clientY + 'px';
    rip.animate([{ opacity: .9, transform: 'scale(.4)' }, { opacity: 0, transform: 'scale(1.6)' }], { duration: 520, easing: 'ease-out' });
  }, true);
  window.__caption = (t) => { const c = band.querySelector('.cap'); c.style.opacity = 0; setTimeout(() => { c.textContent = t; c.style.opacity = 1; }, 180); };
  window.__card = (html) => {
    let c = document.getElementById('__card');
    if (!html) { if (c) { c.style.opacity = 0; setTimeout(() => c.remove(), 650); } return; }
    if (!c) { c = document.createElement('div'); c.id = '__card'; document.body.appendChild(c); }
    c.innerHTML = '<div class="box">' + html + '</div>'; c.style.opacity = 1;
  };
})();
`;

async function caption(page: Page, text: string) {
  await page.evaluate((t) => (window as unknown as { __caption: (t: string) => void }).__caption(t), text);
}
async function card(page: Page, html: string | null) {
  await page.evaluate((h) => (window as unknown as { __card: (h: string | null) => void }).__card(h), html);
}
async function center(page: Page, testId: string, nth = 0) {
  const b = (await page.getByTestId(testId).nth(nth).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}
async function glide(page: Page, to: { x: number; y: number }, steps = 28) {
  await page.mouse.move(to.x, to.y, { steps });
}
async function click(page: Page, testId: string, nth = 0) {
  const p = await center(page, testId, nth);
  await glide(page, p);
  await sleep(180);
  await page.mouse.down();
  await page.mouse.up();
}
async function chordPoint(page: Page, key: string) {
  return page.evaluate((k) => {
    const g = document.querySelector(`[data-testid="chord"][data-pair="${k}"]`)!;
    const path = g.querySelector("path:last-of-type") as SVGPathElement;
    const len = path.getTotalLength();
    const m = path.getScreenCTM()!;
    for (const t of [0.5, 0.4, 0.6, 0.3, 0.7]) {
      const p = path.getPointAtLength(len * t);
      const s = { x: p.x * m.a + p.y * m.c + m.e, y: p.x * m.b + p.y * m.d + m.f };
      const hit = document.elementFromPoint(s.x, s.y);
      if (hit && g.contains(hit)) return s;
    }
    const p = path.getPointAtLength(len / 2);
    return { x: p.x * m.a + p.y * m.c + m.e, y: p.x * m.b + p.y * m.d + m.f };
  }, key);
}
const value = async (page: Page, testId: string) => page.getByTestId(testId).first().getAttribute("data-value");
const text = async (page: Page, testId: string) => (await page.getByTestId(testId).first().textContent())?.trim() ?? "";

async function main() {
  await waitForServer();
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  browser = await chromium.launch({ channel: "chrome" });
  const context = await browser.newContext({ viewport: { width: W, height: APP_H + BAND }, deviceScaleFactor: 1, reducedMotion: "no-preference", acceptDownloads: true });
  const page = await context.newPage();
  await page.addInitScript({ content: `addEventListener('DOMContentLoaded', () => { ${OVERLAY} });` });
  const cdp = await context.newCDPSession(page);
  const frames: { file: string; t: number }[] = [];
  cdp.on("Page.screencastFrame", async (f) => {
    const file = `f${String(frames.length).padStart(5, "0")}.png`;
    writeFileSync(`${OUT}/${file}`, Buffer.from(f.data, "base64"));
    frames.push({ file, t: f.metadata.timestamp ?? Date.now() / 1000 });
    await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => undefined);
  });
  const marks: { label: string; t: number }[] = [];
  const mark = (label: string) => marks.push({ label, t: Date.now() / 1000 });
  /** A storyboard still: the frame on screen at this moment. */
  const shots: { label: string; t: number }[] = [];
  const shot = async (label: string) => {
    await sleep(350);
    shots.push({ label, t: Date.now() / 1000 });
  };

  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => document.fonts.ready);
  // 0-6 s: title over the map as it draws; the dev run streams (the card is up before the first frame)
  await card(page, '<h1>CROSSTALK</h1><p>An agent has to pick one of Twilio\'s <span class="accent">197</span> Voice API operations.<br/>Which ones will it confuse?</p>');
  await caption(page, "An agent has to pick one of Twilio's 197 Voice API operations. Which ones will it confuse?");
  await page.mouse.move(W - 60, APP_H - 30);
  await sleep(250);
  // PNG frames: static areas stay bit-identical between frames, so the GIF encoder only stores what changed
  await cdp.send("Page.startScreencast", { format: "png", everyNthFrame: 1 });
  mark("start");
  await page.waitForSelector('[data-testid="run-status"][data-running="0"][data-done="183"]');
  await sleep(1800);
  await shot("title");
  await sleep(800);
  await card(page, null);
  await sleep(1400);

  // 6-18 s: only destructive confusions; hover the demo chord; the DELETE badge pulses
  mark("delete-only");
  await caption(page, "Show only the confusions that touch a DELETE operation.");
  await click(page, "delete-only");
  await sleep(1300);
  const pt = await chordPoint(page, demoKey);
  await glide(page, pt, 36);
  const hc = page.getByTestId("hover-card").filter({ hasText: demo.pair[1] }).last();
  await hc.waitFor();
  const worst = (await hc.locator("p").first().textContent())?.trim() ?? "";
  await caption(page, `Red is a real mistake. For ${worst} the router picked ${demo.pair[1]}: a destructive delete.`);
  await sleep(1200);
  await shot("hover-delete");
  await sleep(4000);

  // 18-32 s: open the pair, make the boundary explicit, save
  mark("edit");
  await page.mouse.down();
  await page.mouse.up();
  await caption(page, "The wording is the only lever, so I make the boundary explicit.");
  await page.getByTestId("pair-editor").waitFor();
  await sleep(900);
  for (const [op, t] of Object.entries(demo.edits)) {
    for (const [field, id] of [
      ["what", `what-${op}`],
      ["not_for", `notfor-${op}`],
    ] as const) {
      const v = t[field];
      if (v === undefined) continue;
      const box = page.getByTestId(id);
      await box.scrollIntoViewIfNeeded();
      await click(page, id);
      await box.fill("");
      await box.pressSequentially(v, { delay: 22 });
      await sleep(500);
    }
  }
  await shot("edit");
  await sleep(300);
  // move the pointer off the map before saving, so no hover card hides the result
  await glide(page, { x: 1250, y: 760 }, 20);
  await page.keyboard.press("Control+s");
  mark("save");

  // 32-42 s: the rerun streams; read the results from the page
  await page.waitForSelector('[data-testid="run-status"][data-running="0"][data-done="183"]');
  await sleep(1500);
  const fixed = await value(page, "count-fixed");
  const broke = await value(page, "count-broke");
  const acc = Number(await value(page, "acc-value")).toFixed(1);
  const wall = await text(page, "wall-time");
  const cost = await text(page, "run-cost");
  await caption(page, `Fixed ${fixed}, broke ${broke}: dev accuracy ${acc}%, rerun in ${wall}, ${cost} if it were live. Every save reruns the whole dev set.`);
  await shot("result");
  await sleep(5200);

  // 42-50 s: the Gate
  mark("gate");
  await click(page, "tab-gate");
  await caption(page, "Now pick where the router acts alone and where a human checks.");
  await page.getByTestId("gate-strip").waitFor();
  await sleep(900);
  const strip = (await page.getByTestId("gate-strip").boundingBox())!;
  const tauX = strip.x + 18 + 0.5 * (strip.width - 36);
  await glide(page, { x: tauX, y: strip.y + 40 }, 24);
  await page.mouse.down();
  await page.mouse.move(strip.x + 18 + 0.78 * (strip.width - 36), strip.y + 40, { steps: 40 });
  await sleep(400);
  await page.mouse.move(strip.x + 18 + 0.35 * (strip.width - 36), strip.y + 40, { steps: 50 });
  await sleep(300);
  await page.mouse.move(strip.x + 18 + 0.6 * (strip.width - 36), strip.y + 40, { steps: 30 });
  await page.mouse.up();
  await shot("gate");
  await sleep(2100);

  // 50-57 s: the sealed test, once
  mark("seal");
  await click(page, "tab-map");
  await sleep(500);
  await click(page, "seal-button");
  await caption(page, "Then the test set, once. The ledger counts every look.");
  await sleep(1200);
  await click(page, "unseal");
  await page.getByTestId("seal-result").waitFor({ timeout: 30_000 });
  const testAcc = await text(page, "test-accuracy");
  await sleep(700);
  const peeks = await page.getByTestId("peeks").getAttribute("data-count");
  await caption(page, `The sealed test, run once: ${testAcc.split(" ")[0]} on test next to ${acc}% on dev. Peeks: ${peeks}.`);
  await shot("seal");
  await sleep(3500);
  await page.keyboard.press("Escape");
  await sleep(500);

  // 57-60 s: exports, then the end card
  mark("export");
  await click(page, "export-button");
  await caption(page, "Wording in, regression tests out.");
  await sleep(2200);
  await page.keyboard.press("Escape");
  await card(
    page,
    '<h1>CROSSTALK</h1><p>Wording in, regression tests out.</p><p class="small">runs offline · npm run demo · any /v1/systemone backend<br/>MOCK · lexical stand-in, not Jev · not affiliated with Twilio or TypeSafe</p>',
  );
  await sleep(1200);
  await shot("end");
  await sleep(2000);
  mark("end");
  await cdp.send("Page.stopScreencast");
  await sleep(300);
  // key frames for a storyboard
  writeFileSync(`${OUT}/index.json`, JSON.stringify({ width: W, height: APP_H + BAND, frames, marks, shots }, null, 1));
  await browser.close();
  console.log(`${frames.length} frames over ${(marks.at(-1)!.t - marks[0]!.t).toFixed(1)} s → ${OUT}`);
}

let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await browser?.close().catch(() => undefined);
    server.kill();
  });
