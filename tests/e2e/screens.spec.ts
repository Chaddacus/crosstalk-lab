/**
 * Visual snapshots (reduced motion, animations disabled). Also writes the README screenshots to docs/screenshots/.
 * Update the baselines with: npx playwright test tests/e2e/screens.spec.ts --update-snapshots
 */
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { chordPoint, openApp, waitForRun } from "./helpers.ts";

const demo = JSON.parse(readFileSync("tests/e2e/demo.json", "utf8")) as { pair: [string, string]; edits: Record<string, { what?: string; not_for?: string }> };
const demoKey = [...demo.pair].sort().join("|");
const OUT = process.env.SHOTS_DIR ?? "docs/screenshots";

async function snap(page: Page, name: string) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  await expect(page).toHaveScreenshot(`${name}.png`, { maxDiffPixelRatio: 0.01, animations: "disabled" });
}

async function demoEdit(page: Page) {
  const pt = await chordPoint(page, demoKey);
  await page.mouse.click(pt.x, pt.y);
  for (const [op, t] of Object.entries(demo.edits)) {
    if (t.what !== undefined) await page.getByTestId(`what-${op}`).fill(t.what);
    if (t.not_for !== undefined) await page.getByTestId(`notfor-${op}`).fill(t.not_for);
  }
  await page.getByTestId("save-rerun").click();
  await expect(page.getByTestId("history-node")).toHaveCount(2);
  await waitForRun(page);
}

test.describe("desktop 1440×900", () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test("hero", async ({ page }) => {
    await openApp(page);
    await snap(page, "hero-1440");
  });
  test("hover card", async ({ page }) => {
    await openApp(page);
    const pt = await chordPoint(page, demoKey);
    await page.mouse.move(pt.x, pt.y);
    await expect(page.getByTestId("hover-card")).toBeVisible();
    await snap(page, "hover-1440");
  });
  test("after the demo edit", async ({ page }) => {
    await openApp(page);
    await demoEdit(page);
    await page.mouse.move(5, 895);
    await snap(page, "after-edit-1440");
  });
  test("gate", async ({ page }) => {
    await openApp(page);
    await page.getByTestId("tab-gate").click();
    await snap(page, "gate-1440");
  });
  test("item inspector", async ({ page }) => {
    await openApp(page);
    await page.getByTestId("tab-items").click();
    await page.getByTestId("item-row").nth(2).click();
    await expect(page.getByTestId("inspector")).toBeVisible();
    await snap(page, "inspector-1440");
  });
  test("seal result", async ({ page }) => {
    await openApp(page);
    await page.getByTestId("seal-button").click();
    await page.getByTestId("unseal").click();
    await expect(page.getByTestId("seal-result")).toBeVisible({ timeout: 30_000 });
    await page.addStyleTag({ content: '[data-testid="ledger"] li span:last-child { visibility: hidden; }' });
    await snap(page, "seal-1440");
  });
});

test.describe("video 1920×1080", () => {
  test.use({ viewport: { width: 1920, height: 1080 } });
  test("hero", async ({ page }) => {
    await openApp(page);
    await snap(page, "hero-1920");
  });
});

test.describe("phone 390×844", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test("hero", async ({ page }) => {
    await openApp(page);
    await snap(page, "hero-390");
  });
  test("editor sheet", async ({ page }) => {
    await openApp(page);
    await page.getByTestId("pairs-item").first().click();
    await expect(page.getByTestId("bottom-sheet")).toBeVisible();
    await snap(page, "sheet-390");
  });
});
