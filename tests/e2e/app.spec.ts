import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { chordPoint, counts, N_DEV, openApp, waitForRun } from "./helpers.ts";
import { toWire } from "../../src/core/jev/wire.ts";
import { buildRequest } from "../../src/core/run/request.ts";
import { runItems } from "../../src/core/run/runner.ts";
import { createMockBackend } from "../../src/core/jev/mock-lexsim.ts";
import { criteriaHash } from "../../src/core/data/criteria.ts";
import { parseJsonl } from "../../src/core/data/splits.ts";

const demo = JSON.parse(readFileSync("tests/e2e/demo.json", "utf8")) as {
  pair: [string, string];
  edits: Record<string, { what?: string; not_for?: string }>;
  expected: { fixed: number; broke: number; unchanged: number };
};
const demoKey = [...demo.pair].sort().join("|");

test("loads with the MOCK watermark, 197 ticks, 22 family arcs and the NO MATCH hub", async ({ page }) => {
  await openApp(page);
  await expect(page.getByTestId("mock-watermark")).toBeVisible();
  await expect(page.getByTestId("mock-watermark")).toContainText("MOCK · lexical stand-in, not Jev");
  await expect(page.getByTestId("op-tick")).toHaveCount(197);
  await expect(page.getByTestId("family-arc")).toHaveCount(22);
  await expect(page.getByTestId("hub")).toContainText("NO MATCH");
  await expect(page.getByTestId("map")).toHaveAttribute("role", "img");
  await expect(page.getByTestId("map")).toHaveAttribute("aria-label", /Top confusions: .+⇄.+/);
});

test("the dev run completes and the accuracy card shows a value and an interval", async ({ page }) => {
  await openApp(page);
  await expect(page.getByTestId("run-status")).toContainText(`${N_DEV}/${N_DEV}`);
  const acc = Number(await page.getByTestId("acc-value").getAttribute("data-value"));
  expect(acc).toBeGreaterThan(0);
  expect(acc).toBeLessThan(100);
  await expect(page.getByTestId("acc-interval")).toHaveText(/\[\d+\.\d% – \d+\.\d%\]/);
});

test("hovering the top chord shows the worst item; clicking loads both operations into the editor", async ({ page }) => {
  await openApp(page);
  const top = page.getByTestId("chord").filter({ has: page.locator("path") });
  const key = await page.getByTestId("pairs-item").first().getAttribute("data-pair");
  expect(key).toBeTruthy();
  const pt = await chordPoint(page, key!);
  await page.mouse.move(pt.x, pt.y);
  const card = page.getByTestId("hover-card");
  await expect(card).toBeVisible();
  await expect(card).toContainText("worst item");
  await expect(card).toContainText("gold");
  await page.mouse.click(pt.x, pt.y);
  await expect(page.getByTestId("pair-editor")).toBeVisible();
  await expect(page.getByTestId("option-card")).toHaveCount(2);
  expect(await top.count()).toBeGreaterThan(10);
});

test("scripted demo edit: save reruns dev; counts match the golden; history gains v1; the chord thins", async ({ page }) => {
  await openApp(page);
  const chord = page.locator(`[data-testid="chord"][data-pair="${demoKey}"]`);
  const massBefore = Number(await chord.getAttribute("data-mass"));
  const pt = await chordPoint(page, demoKey);
  await page.mouse.click(pt.x, pt.y);
  await expect(page.getByTestId("pair-title")).toContainText(demo.pair[0]);
  for (const [op, t] of Object.entries(demo.edits)) {
    if (t.what !== undefined) await page.getByTestId(`what-${op}`).fill(t.what);
    if (t.not_for !== undefined) await page.getByTestId(`notfor-${op}`).fill(t.not_for);
  }
  await expect(page.getByTestId("dirty-dot")).toHaveCount(2);
  await page.getByTestId("save-rerun").click();
  await expect(page.getByTestId("history-node")).toHaveCount(2);
  await waitForRun(page);
  const c = await counts(page);
  expect(c.fixed + c.broke + c.unchanged).toBe(N_DEV);
  expect(c).toEqual(demo.expected);
  await expect(page.locator('[data-testid="history-node"][data-version="v1"]')).toBeVisible();
  const massAfter = Number(await chord.getAttribute("data-mass"));
  expect(massAfter).toBeLessThan(massBefore);
  await expect(page.getByTestId("flipped-list")).toContainText("FIXED");
  await expect(page.getByTestId("wall-time")).not.toHaveText("—");
});

test("determinism: the same criteria give the same run hash, in the browser and in Node", async ({ page }) => {
  await openApp(page);
  const h1 = await page.getByTestId("run-hash").textContent();
  await page.reload();
  await waitForRun(page);
  const h2 = await page.getByTestId("run-hash").textContent();
  expect(h1).toMatch(/run [0-9a-f]{10}/);
  expect(h2).toBe(h1);
  // the CLI path (Node) gives the same bits as the Web Worker (Chrome)
  const v0 = JSON.parse(readFileSync("data/twilio-v2010/criteria.v0.json", "utf8"));
  const dev = parseJsonl(readFileSync("data/twilio-v2010/dev.jsonl", "utf8"));
  const node = await runItems({ backend: createMockBackend(), items: dev, criteria: v0, criteriaHash: await criteriaHash(v0), model: "mock-lexsim-1", split: "dev" });
  expect(h1).toBe(`run ${node.runHash.slice(0, 10)}`);
});

test("gate: moving τ right lowers coverage monotonically; policy.json downloads and validates", async ({ page }) => {
  await openApp(page);
  await page.getByTestId("tab-gate").click();
  const strip = page.getByTestId("gate-strip");
  await expect(strip).toBeVisible();
  await expect(page.getByTestId("mock-gate-banner")).toContainText("not calibrated");
  // start at τ = 0 by dragging to the far left, then step right with the keyboard
  const box = (await strip.boundingBox())!;
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 1, box.y + box.height / 2);
  await page.mouse.up();
  await strip.focus();
  let last = Infinity;
  const seen: number[] = [];
  for (let i = 0; i < 10; i++) {
    const cov = Number(await page.getByTestId("kpi-coverage").getAttribute("data-value"));
    seen.push(cov);
    expect(cov).toBeLessThanOrEqual(last);
    last = cov;
    await page.keyboard.press("Shift+ArrowRight");
  }
  expect(seen[0]).toBeGreaterThan(seen[seen.length - 1]!);
  const tau = Number((await page.getByTestId("tau-label").textContent())!.replace(/[^\d.]/g, ""));
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-policy").click()]);
  expect(dl.suggestedFilename()).toBe("policy.json");
  const policy = JSON.parse(readFileSync((await dl.path())!, "utf8"));
  expect(policy.kind).toBe("crosstalk-gate-policy");
  expect(policy.threshold).toBeCloseTo(tau, 2);
  expect(policy.criteria.sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(policy.devMetrics.n).toBe(N_DEV);
});

test("seal: no request for test.jsonl before unseal; unseal runs once, shows test next to dev, and peeks persist", async ({ page }) => {
  const requested: string[] = [];
  page.on("request", (r) => requested.push(r.url()));
  await openApp(page);
  await page.getByTestId("tab-gate").click();
  await page.getByTestId("tab-items").click();
  await page.getByTestId("tab-map").click();
  expect(requested.filter((u) => /test[^/]*\.jsonl/.test(u))).toEqual([]);
  await expect(page.getByTestId("peeks")).toHaveAttribute("data-count", "0");
  await page.getByTestId("seal-button").click();
  await expect(page.getByTestId("seal-modal")).toContainText("It records one peek.");
  await page.getByTestId("unseal").click();
  await expect(page.getByTestId("seal-result")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("test-accuracy")).toHaveText(/\d+\.\d%/);
  expect(requested.filter((u) => /test[^/]*\.jsonl/.test(u))).toHaveLength(1);
  await expect(page.getByTestId("peeks")).toHaveAttribute("data-count", "1");
  await page.reload();
  await waitForRun(page);
  await expect(page.getByTestId("peeks")).toHaveAttribute("data-count", "1");
});

test("static build: LIVE is disabled and says how to enable it", async ({ page }) => {
  await openApp(page);
  await expect(page.getByTestId("backend-live")).toBeDisabled();
  await expect(page.getByTestId("backend-live-wrap")).toHaveAttribute("title", /npm run live/);
  await expect(page.getByTestId("backend-mock")).toHaveAttribute("aria-checked", "true");
});

test("REPLAY replays the committed mock fixtures for v0", async ({ page }) => {
  await openApp(page);
  const accMock = await page.getByTestId("acc-value").getAttribute("data-value");
  await page.getByTestId("backend-replay").click();
  await expect(page.getByTestId("backend-chip")).toContainText("REPLAY");
  await waitForRun(page);
  expect(await page.getByTestId("acc-value").getAttribute("data-value")).toBe(accMock);
});

test("exports: criteria validates against the wire schema; the regression file has one case per fixed item", async ({ page }) => {
  await openApp(page);
  const pt = await chordPoint(page, demoKey);
  await page.mouse.click(pt.x, pt.y);
  for (const [op, t] of Object.entries(demo.edits)) {
    if (t.what !== undefined) await page.getByTestId(`what-${op}`).fill(t.what);
    if (t.not_for !== undefined) await page.getByTestId(`notfor-${op}`).fill(t.not_for);
  }
  await page.getByTestId("save-rerun").click();
  await expect(page.getByTestId("history-node")).toHaveCount(2);
  await waitForRun(page);

  await page.getByTestId("export-button").click();
  const [d1] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-criteria").click()]);
  expect(d1.suggestedFilename()).toBe("criteria.twilio-v2010.v1.json");
  const criteria = JSON.parse(readFileSync((await d1.path())!, "utf8"));
  expect(Object.keys(criteria)).toHaveLength(198);
  expect(() => toWire(buildRequest(criteria, "probe", "jev-1.13.0"))).not.toThrow();
  expect(criteria.UpdateCall.what).toBe(demo.edits.UpdateCall!.what);

  await page.getByTestId("export-button").click();
  const [d2] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-regressions").click()]);
  const reg = readFileSync((await d2.path())!, "utf8");
  expect(reg.match(/\n {2}it\(/g)).toHaveLength(demo.expected.fixed);

  await page.getByTestId("export-button").click();
  const [d3] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-run").click()]);
  const run = JSON.parse(readFileSync((await d3.path())!, "utf8"));
  expect(run.results).toHaveLength(N_DEV);
});

test("keyboard: Tab reaches the Pairs list; [ and ] change the chord; Ctrl+S saves", async ({ page }) => {
  await openApp(page);
  let onPairs = false;
  for (let i = 0; i < 30 && !onPairs; i++) {
    await page.keyboard.press("Tab");
    onPairs = await page.evaluate(() => document.activeElement?.getAttribute("data-testid") === "pairs-item");
  }
  expect(onPairs).toBe(true);
  await page.keyboard.press("]");
  const t1 = await page.getByTestId("pair-title").textContent();
  await page.keyboard.press("]");
  const t2 = await page.getByTestId("pair-title").textContent();
  expect(t2).not.toBe(t1);
  await page.keyboard.press("[");
  expect(await page.getByTestId("pair-title").textContent()).toBe(t1);
  const firstCard = page.getByTestId("option-card").first();
  const op = await firstCard.getAttribute("data-op");
  await page.getByTestId(`examples-${op}`).fill("an extra example request");
  await page.keyboard.press("Control+s");
  await expect(page.getByTestId("history-node")).toHaveCount(2);
  await waitForRun(page);
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test("390×844: no horizontal scroll; the map and the panel tabs render", async ({ page }) => {
    await openApp(page);
    await expect(page.getByTestId("narrow")).toBeVisible();
    await expect(page.getByTestId("op-tick")).toHaveCount(197);
    await expect(page.getByTestId("mock-watermark")).toBeVisible();
    for (const p of ["pair", "diff", "history"]) await expect(page.getByTestId(`mpanel-${p}`)).toBeVisible();
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(sw).toBeLessThanOrEqual(390);
    await page.getByTestId("pairs-item").first().click();
    await expect(page.getByTestId("bottom-sheet")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});
