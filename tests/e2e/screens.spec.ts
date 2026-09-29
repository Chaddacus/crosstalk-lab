/**
 * Visual snapshots (reduced motion, animations disabled), compared against the baselines in
 * screens.spec.ts-snapshots/. A normal `npm run test:e2e` writes its PNGs to test-results/screens/ and never
 * touches tracked files. `npm run shots` (npm sets npm_lifecycle_event=shots) writes the README images to
 * docs/screenshots/ on purpose; SHOTS_DIR overrides both.
 * Update the baselines with: npx playwright test tests/e2e/screens.spec.ts --update-snapshots
 */
import { expect, test, type Page } from "@playwright/test";
import { chordPoint, demoEdit, demoKey, openApp } from "./helpers.ts";

const OUT = process.env.SHOTS_DIR ?? (process.env.npm_lifecycle_event === "shots" ? "docs/screenshots" : "test-results/screens");

async function snap(page: Page, name: string) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  await expect(page).toHaveScreenshot(`${name}.png`, { maxDiffPixelRatio: 0.01, animations: "disabled" });
}

test.describe("desktop 1440×900", () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test("hero", async ({ page }) => {
    await openApp(page);
    await snap(page, "hero-1440");
  });
  test("hover card on the demo pair (DELETE only)", async ({ page }) => {
    await openApp(page);
    await page.getByTestId("delete-only").check();
    const pt = await chordPoint(page, demoKey);
    await page.mouse.move(pt.x, pt.y);
    await expect(page.getByTestId("hover-card")).toBeVisible();
    await expect(page.getByTestId("delete-badge")).toBeVisible();
    await snap(page, "hover-1440");
  });
  test("after the demo edit", async ({ page }) => {
    await openApp(page);
    await demoEdit(page);
    await page.mouse.move(5, 895);
    await snap(page, "after-edit-1440");
  });
  test("NO MATCH lens", async ({ page }) => {
    await openApp(page);
    await page.getByTestId("lens-hub").first().click();
    await snap(page, "nomatch-1440");
  });
  test("gate", async ({ page }) => {
    await openApp(page);
    await page.getByTestId("tab-gate").click();
    await snap(page, "gate-1440");
  });
  test("item inspector", async ({ page }) => {
    await openApp(page);
    await page.getByTestId("tab-items").click();
    await page.getByTestId("item-open").nth(2).click();
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

test.describe("drawer layout 1024×768", () => {
  test.use({ viewport: { width: 1024, height: 768 } });
  test("hero with the Diff drawer open", async ({ page }) => {
    await openApp(page);
    await page.getByTestId("drawer-toggle").click();
    await expect(page.getByTestId("diff-rail")).toBeVisible();
    await snap(page, "hero-1024");
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
  test("item inspector sheet", async ({ page }) => {
    await openApp(page);
    await page.getByTestId("tab-items").click();
    await page.getByTestId("item-open").nth(2).click();
    await expect(page.getByTestId("inspector-close")).toBeVisible();
    await snap(page, "inspector-390");
  });
});
