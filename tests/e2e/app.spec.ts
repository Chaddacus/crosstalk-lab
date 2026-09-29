import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { chordPoint, counts, demo, demoEdit, demoKey, expectNoHorizontalScroll, fillDemo, N_DEV, openApp, waitForRun } from "./helpers.ts";
import { toWire } from "../../src/core/jev/wire.ts";
import { buildRequest } from "../../src/core/run/request.ts";
import { runItems } from "../../src/core/run/runner.ts";
import { createMockBackend } from "../../src/core/jev/mock-lexsim.ts";
import { criteriaHash } from "../../src/core/data/criteria.ts";
import { parseJsonl } from "../../src/core/data/splits.ts";

/** Mass of a chord, or 0 once it has left the map (its leak fell under 0.001). */
async function chordMass(page: Page, key: string): Promise<number> {
  const chord = page.locator(`[data-testid="chord"][data-pair="${key}"]`);
  return (await chord.count()) ? Number(await chord.getAttribute("data-mass")) : 0;
}

test("loads with the MOCK watermark, 197 ticks, 22 family arcs and the NO MATCH hub", async ({ page }) => {
  await openApp(page);
  await expect(page.getByTestId("mock-watermark")).toBeVisible();
  await expect(page.getByTestId("mock-watermark")).toContainText("MOCK · lexical stand-in, not Jev");
  await expect(page.getByTestId("op-tick")).toHaveCount(197);
  await expect(page.getByTestId("family-arc")).toHaveCount(22);
  await expect(page.getByTestId("hub")).toContainText("NO MATCH");
  await expect(page.getByTestId("map")).toHaveAttribute("role", "img");
  await expect(page.getByTestId("map")).toHaveAttribute("aria-label", /Top confusions between look-alike operations: .+⇄.+/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
});

test("the default lens ranks look-alike operation pairs; the NO MATCH lens ranks spokes", async ({ page }) => {
  await openApp(page);
  // default: operation ⇄ operation only, top 20, the top 5 labeled on the ring
  await expect(page.getByTestId("lens-ops").first()).toHaveAttribute("aria-checked", "true");
  const hubChords = page.locator('[data-testid="chord"][data-hub="1"]');
  await expect(hubChords).toHaveCount(0);
  await expect(page.locator('[data-testid="chord"]')).toHaveCount(20);
  const firstPair = (await page.getByTestId("pairs-item").first().getAttribute("data-pair"))!;
  expect(firstPair).not.toContain("none_of_these");
  const [a, b] = firstPair.split("|");
  await expect(page.locator(`[data-testid="op-label"][data-op="${a}"]`)).toHaveCount(1);
  await expect(page.locator(`[data-testid="op-label"][data-op="${b}"]`)).toHaveCount(1);
  // NO MATCH lens: every drawn chord is a spoke, and the top spoke's operation is labeled
  await page.getByTestId("lens-hub").first().click();
  await expect(page.locator('[data-testid="chord"][data-hub="0"]')).toHaveCount(0);
  const spoke = (await page.getByTestId("pairs-item").first().getAttribute("data-pair"))!;
  expect(spoke).toContain("none_of_these");
  const op = spoke.split("|").find((x) => x !== "none_of_these")!;
  await expect(page.locator(`[data-testid="op-label"][data-op="${op}"]`)).toHaveCount(1);
  // the top chords carry the most emphasis
  await expect(page.locator('[data-testid="chord"][data-rank="0"]')).toHaveCount(1);
});

test("the dev run completes and the accuracy card shows a value and an interval", async ({ page }) => {
  await openApp(page);
  await expect(page.getByTestId("run-status")).toContainText(`${N_DEV}/${N_DEV}`);
  const acc = Number(await page.getByTestId("acc-value").getAttribute("data-value"));
  expect(acc).toBeGreaterThan(0);
  expect(acc).toBeLessThan(100);
  await expect(page.getByTestId("acc-interval")).toHaveText(/\[\d+\.\d% – \d+\.\d%\]/);
  await expect(page.getByTestId("run-scope")).toContainText(`${N_DEV} scored`);
});

test("hovering the top chord shows the worst item; clicking loads both operations into the editor", async ({ page }) => {
  await openApp(page);
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
  // both wordings stay visible in the pinned summary
  await expect(page.getByTestId("summary-a")).toBeVisible();
  await expect(page.getByTestId("summary-b")).toBeVisible();
});

test("the demo pair is a real DELETE misroute: the hover card shows DELETE PICKED", async ({ page }) => {
  await openApp(page);
  await page.getByTestId("delete-only").check();
  const pt = await chordPoint(page, demoKey);
  await page.mouse.move(pt.x, pt.y);
  const card = page.getByTestId("hover-card");
  await expect(card).toBeVisible();
  await expect(card.getByTestId("delete-badge")).toBeVisible();
  await expect(card).toContainText(demo.pair[1]);
  await expect(page.locator(`[data-testid="chord"][data-pair="${demoKey}"]`)).toHaveAttribute("data-state", "error");
});

test("scripted demo edit: save reruns dev; counts match the golden; risk drops; the chord thins or leaves", async ({ page }) => {
  await openApp(page);
  const riskBefore = Number(await page.getByTestId("risk-value").getAttribute("data-value"));
  await page.getByTestId("delete-only").check();
  const massBefore = await chordMass(page, demoKey);
  expect(massBefore).toBeGreaterThan(0.1);
  const pt = await chordPoint(page, demoKey);
  await page.mouse.click(pt.x, pt.y);
  await expect(page.getByTestId("pair-title")).toContainText(demo.pair[0]);
  await fillDemo(page);
  await expect(page.getByTestId("dirty-dot")).toHaveCount(2);
  await page.getByTestId("save-rerun").click();
  await expect(page.getByTestId("history-node")).toHaveCount(2);
  await waitForRun(page);
  const c = await counts(page);
  expect(c.fixed + c.broke + c.unchanged).toBe(N_DEV);
  expect(c).toEqual(demo.expected);
  await expect(page.locator('[data-testid="history-node"][data-version="v1"]')).toBeVisible();
  await expect.poll(() => chordMass(page, demoKey)).toBeLessThan(massBefore);
  await expect(page.getByTestId("flipped-list")).toContainText("FIXED");
  await expect(page.getByTestId("wall-time")).not.toHaveText("—");
  const riskAfter = Number(await page.getByTestId("risk-value").getAttribute("data-value"));
  expect(riskAfter).toBeLessThan(riskBefore);
});

test("'Try the demo pair' opens it, and 'Fill in the demo edit' reproduces the golden", async ({ page }) => {
  await openApp(page);
  await page.getByTestId("demo-pair").click();
  await expect(page.getByTestId("pair-title")).toContainText(demo.pair[0]);
  await page.getByTestId("fill-demo").click();
  await expect(page.getByTestId("dirty-dot")).toHaveCount(2);
  await page.getByTestId("save-rerun").click();
  await waitForRun(page);
  await expect(page.getByTestId("history-node")).toHaveCount(2);
  expect(await counts(page)).toEqual(demo.expected);
});

test("viewing an older version shows its own text, read only, with Restore", async ({ page }) => {
  await openApp(page);
  await demoEdit(page);
  const [op] = Object.keys(demo.edits);
  await page.locator('[data-testid="history-node"][data-version="v0"]').click();
  await expect(page.getByTestId("viewing-banner")).toContainText("Viewing v0 (read only)");
  const what = page.getByTestId(`what-${op}`);
  await expect(what).toHaveAttribute("readonly", "");
  await expect(what).not.toHaveValue(demo.edits[op!]!.what ?? "__none__");
  await expect(page.getByTestId("save-rerun")).toBeDisabled();
  await page.getByRole("button", { name: "Back to v1" }).click();
  await expect(page.getByTestId("viewing-banner")).toHaveCount(0);
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
  const runHash = (await page.getByTestId("run-hash").textContent())!.replace("run ", "");
  await page.getByTestId("tab-gate").click();
  const strip = page.getByTestId("gate-strip");
  await expect(strip).toBeVisible();
  await expect(page.getByTestId("mock-gate-banner")).toContainText("not calibrated");
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
  expect(policy.run.sha256.startsWith(runHash)).toBe(true);
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
  await expect(page.getByTestId("seal-dev-col")).toContainText("dev · v0");
  await expect(page.getByTestId("seal-test-col")).toContainText("test · v0");
  expect(requested.filter((u) => /test[^/]*\.jsonl/.test(u))).toHaveLength(1);
  await expect(page.getByTestId("peeks")).toHaveAttribute("data-count", "1");
  await page.reload();
  await waitForRun(page);
  await expect(page.getByTestId("peeks")).toHaveAttribute("data-count", "1");
});

test("seal: after an edit, the old test result is labeled with its own version and marked stale (never mixed)", async ({ page }) => {
  await openApp(page);
  await page.getByTestId("seal-button").click();
  await page.getByTestId("unseal").click();
  await expect(page.getByTestId("seal-result")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("seal-close").click();
  await demoEdit(page);
  await page.getByTestId("seal-button").click();
  await expect(page.getByTestId("seal-stale")).toContainText("test result is for v0; current is v1");
  await expect(page.getByTestId("seal-dev-col")).toContainText("dev · v0");
  await expect(page.getByTestId("seal-test-col")).toContainText("test · v0");
});

test("dialogs: focus moves in, Tab stays in, Escape closes and returns focus to the opener", async ({ page }) => {
  await openApp(page);
  const opener = page.getByTestId("seal-button");
  await opener.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("seal-modal")).toBeVisible();
  const inside = () => page.evaluate(() => !!document.activeElement?.closest('[data-testid="seal-modal"]'));
  await expect.poll(inside).toBe(true);
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    expect(await inside()).toBe(true);
  }
  // the background is inert while the dialog is open
  await expect(page.getByTestId("shell")).toHaveAttribute("inert", "");
  // global shortcuts are off behind the dialog
  await page.keyboard.press("2");
  await expect(page.getByTestId("tab-map")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("seal-modal")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-testid"))).toBe("seal-button");
  // the shortcut sheet behaves the same
  await page.keyboard.press("?");
  await expect(page.getByTestId("shortcut-sheet")).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-testid"))).toBe("shortcuts-close");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("shortcut-sheet")).toHaveCount(0);
});

test("items: rows open from the keyboard; the error filter exists", async ({ page }) => {
  await openApp(page);
  await page.getByTestId("tab-items").click();
  await expect(page.getByTestId("items-scroll")).toHaveAttribute("tabindex", "0");
  await page.getByTestId("item-open").first().focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("inspector")).toBeVisible();
  await expect(page.locator("select").nth(1).locator("option", { hasText: "error" })).toHaveCount(1);
});

test("static build: LIVE is disabled and says how to enable it", async ({ page }) => {
  await openApp(page);
  await expect(page.getByTestId("backend-live")).toBeDisabled();
  await expect(page.getByTestId("backend-live-wrap")).toHaveAttribute("title", /npm run live/);
  await expect(page.locator("#live-hint")).toContainText("npm run live");
  await expect(page.getByTestId("backend-mock")).toHaveAttribute("aria-checked", "true");
  // clicking it explains instead of doing nothing
  await page.getByTestId("backend-live").click({ force: true });
  await expect(page.getByRole("alert")).toContainText("npm run live");
});

test("REPLAY replays the committed mock fixtures for v0, with honest provenance labels", async ({ page }) => {
  await openApp(page);
  const accMock = await page.getByTestId("acc-value").getAttribute("data-value");
  await page.getByTestId("backend-replay").click();
  await expect(page.getByTestId("backend-chip")).toContainText("REPLAY");
  await waitForRun(page);
  expect(await page.getByTestId("acc-value").getAttribute("data-value")).toBe(accMock);
  await expect(page.getByTestId("diff-rail")).toContainText("tokens est.");
  await page.getByTestId("tab-gate").click();
  await expect(page.getByTestId("gate-view")).toContainText("confidence: derived");
});

test("REPLAY cache misses are failed items, explained in plain words, never a silent fallback", async ({ page }) => {
  await openApp(page);
  await page.getByTestId("backend-replay").click();
  await waitForRun(page);
  // an edit that no fixture covers
  await page.getByTestId("pairs-item").first().click();
  const op = await page.getByTestId("option-card").first().getAttribute("data-op");
  await page.getByTestId(`examples-${op}`).fill("an example no fixture has seen");
  await page.getByTestId("save-rerun").click();
  await expect(page.getByTestId("history-node")).toHaveCount(2);
  await waitForRun(page);
  await expect(page.getByTestId("failed-badge")).toContainText(`${N_DEV} failed`);
  await expect(page.getByTestId("partial-badge")).toContainText(`0 of ${N_DEV} scored`);
  await expect(page.getByTestId("failed-note")).toContainText("no cached response");
  await expect(page.getByRole("alert").first()).not.toContainText("{");
  await expect(page.getByTestId("count-unchanged")).not.toHaveText(String(N_DEV));
});

test("exports: criteria validates against the wire schema; the regression file has one case per fixed item", async ({ page }) => {
  await openApp(page);
  await demoEdit(page);

  await page.getByTestId("export-button").click();
  const [d1] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-criteria").click()]);
  expect(d1.suggestedFilename()).toBe("criteria.twilio-v2010.v1.json");
  const criteria = JSON.parse(readFileSync((await d1.path())!, "utf8"));
  expect(Object.keys(criteria)).toHaveLength(198);
  expect(() => toWire(buildRequest(criteria, "probe", "jev-1.13.0"))).not.toThrow();
  for (const [op, t] of Object.entries(demo.edits)) {
    if (t.what) expect(criteria[op].what).toBe(t.what);
    if (t.not_for) expect(criteria[op].not_for).toBe(t.not_for);
  }

  await page.getByTestId("export-button").click();
  const [d2] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-regressions").click()]);
  const reg = readFileSync((await d2.path())!, "utf8");
  expect(reg.match(/\n {2}it\(/g)).toHaveLength(demo.expected.fixed);
  expect(reg).toContain("createMockBackend()");

  await page.getByTestId("export-button").click();
  const [d3] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-run").click()]);
  const run = JSON.parse(readFileSync((await d3.path())!, "utf8"));
  expect(run.results).toHaveLength(N_DEV);
});

test("keyboard: Tab reaches the Pairs list; [ and ] change the chord; Ctrl+S saves", async ({ page }) => {
  await openApp(page);
  let onPairs = false;
  for (let i = 0; i < 40 && !onPairs; i++) {
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

for (const width of [768, 900, 1024, 1100]) {
  test.describe(`${width} px`, () => {
    test.use({ viewport: { width, height: 800 } });
    test(`${width} px: no horizontal scroll; the top bar controls fit`, async ({ page }) => {
      await openApp(page);
      await expectNoHorizontalScroll(page);
      for (const id of ["seal-button", "backend-switch", "drawer-toggle"]) {
        const box = (await page.getByTestId(id).boundingBox())!;
        expect(box.x + box.width, id).toBeLessThanOrEqual(width);
      }
      await page.getByTestId("drawer-toggle").click();
      await expect(page.getByTestId("diff-rail")).toBeVisible();
      await expectNoHorizontalScroll(page);
    });
  });
}

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test("390×844: no horizontal scroll; the map and the panel tabs render", async ({ page }) => {
    await openApp(page);
    await expect(page.getByTestId("narrow")).toBeVisible();
    await expect(page.getByTestId("op-tick")).toHaveCount(197);
    await expect(page.getByTestId("mock-watermark")).toBeVisible();
    for (const p of ["pair", "diff", "history"]) await expect(page.getByTestId(`mpanel-${p}`)).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.getByTestId("pairs-item").first().click();
    await expect(page.getByTestId("bottom-sheet")).toBeVisible();
    await expect(page.getByTestId("bottom-sheet")).toHaveAttribute("role", "dialog");
    await expect(page.getByTestId("pair-tab-a")).toBeVisible();
    await expect(page.getByTestId("option-card")).toHaveCount(1);
    await page.getByTestId("pair-tab-b").click();
    await expect(page.getByTestId("option-card")).toHaveCount(1);
    await expectNoHorizontalScroll(page);
    await page.getByTestId("pair-close").click();
    await expect(page.getByTestId("bottom-sheet")).toHaveCount(0);
  });

  test("390×844: the item inspector's Close button is reachable and works", async ({ page }) => {
    await openApp(page);
    await page.getByTestId("tab-items").click();
    await page.getByTestId("item-open").first().click();
    await expect(page.getByTestId("inspector")).toBeVisible();
    const close = page.getByTestId("inspector-close");
    const box = (await close.boundingBox())!;
    const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-testid="inspector-close"]') !== null, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    expect(hit).toBe(true);
    await close.click();
    await expect(page.getByTestId("inspector")).toHaveCount(0);
  });

  test("390×844: exports and shortcuts are reachable from the phone header; controls are touch sized", async ({ page }) => {
    await openApp(page);
    await page.getByTestId("more-button").click();
    await expect(page.getByTestId("export-criteria")).toBeVisible();
    await expect(page.getByTestId("more-help")).toBeVisible();
    await page.keyboard.press("Escape");
    for (const id of ["backend-mock", "tab-map", "delete-only-label"]) {
      const el = page.getByTestId(id).first();
      if (!(await el.count())) continue;
      const box = (await el.boundingBox())!;
      expect(box.height, id).toBeGreaterThanOrEqual(32);
    }
  });
});
