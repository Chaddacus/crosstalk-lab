import { readFileSync } from "node:fs";
import { expect, type Page } from "@playwright/test";

export const N_DEV = 183;

export const demo = JSON.parse(readFileSync("tests/e2e/demo.json", "utf8")) as {
  pair: [string, string];
  edits: Record<string, { what?: string; not_for?: string }>;
  expected: { fixed: number; broke: number; unchanged: number };
};
export const demoKey = [...demo.pair].sort().join("|");

/** Wait until the dev run has finished and every result is revealed. */
export async function waitForRun(page: Page, n = N_DEV) {
  await expect(page.getByTestId("run-status").first()).toHaveAttribute("data-running", "0", { timeout: 30_000 });
  await expect(page.getByTestId("run-status").first()).toHaveAttribute("data-done", String(n));
}

export async function openApp(page: Page) {
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  await waitForRun(page);
}

/** Screen point at the middle of an SVG path (a chord's hit path), so hover and click land on the stroke. */
export async function chordPoint(page: Page, pairKey: string) {
  const pt = await page.evaluate((key) => {
    const g = document.querySelector(`[data-testid="chord"][data-pair="${key}"]`);
    const path = g?.querySelector("path:last-of-type") as SVGPathElement | null;
    if (!path) return null;
    const len = path.getTotalLength();
    const m = path.getScreenCTM()!;
    const toScreen = (t: number) => {
      const p = path.getPointAtLength(len * t);
      return { x: p.x * m.a + p.y * m.c + m.e, y: p.x * m.b + p.y * m.d + m.f };
    };
    // prefer a point where this chord is the topmost element, so hover and click reach it
    for (const t of [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8, 0.15, 0.85, 0.1, 0.9]) {
      const s = toScreen(t);
      const hit = document.elementFromPoint(s.x, s.y);
      if (hit && g!.contains(hit)) return s;
    }
    return toScreen(0.5);
  }, pairKey);
  if (!pt) throw new Error(`chord ${pairKey} not found`);
  return pt;
}

export async function counts(page: Page) {
  const v = async (id: string) => Number(await page.getByTestId(id).getAttribute("data-value"));
  return { fixed: await v("count-fixed"), broke: await v("count-broke"), unchanged: await v("count-unchanged") };
}

/** Fill the scripted demo edit into the editor (the pair must be open). */
export async function fillDemo(page: Page) {
  for (const [op, t] of Object.entries(demo.edits)) {
    if (t.what !== undefined) await page.getByTestId(`what-${op}`).fill(t.what);
    if (t.not_for !== undefined) await page.getByTestId(`notfor-${op}`).fill(t.not_for);
  }
}

/**
 * The scripted demo, as in the video: show only chords that touch a DELETE, click the demo chord, fill the
 * edit, save, and wait for the rerun.
 */
export async function demoEdit(page: Page) {
  await page.getByTestId("delete-only").check();
  const pt = await chordPoint(page, demoKey);
  await page.mouse.click(pt.x, pt.y);
  await expect(page.getByTestId("pair-title")).toContainText(demo.pair[0]);
  await fillDemo(page);
  await page.getByTestId("save-rerun").click();
  await expect(page.getByTestId("history-node")).toHaveCount(2);
  await waitForRun(page);
}

/** No sideways page scroll at the current viewport. */
export async function expectNoHorizontalScroll(page: Page) {
  const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  expect(sw, `scrollWidth ${sw} > innerWidth ${iw}`).toBeLessThanOrEqual(iw);
}
