/**
 * LIVE end to end, with no key and no money: the browser → Vite dev proxy → the local live server (compat preset)
 * → scripts/fake-upstream.ts (the lexical mock behind HTTP; it is not Jev). The server's spend cap ($0.08) covers
 * one full dev run but not two, so the rerun after the demo edit becomes a partial run on purpose.
 */
import { expect, test } from "@playwright/test";
import { counts, demoEdit, N_DEV, openApp, waitForRun } from "./helpers.ts";

test("LIVE through the local server: a full run, then a partial run that is labeled, explained and retryable", async ({ page }) => {
  const authHeaders: string[] = [];
  page.on("request", (r) => {
    const h = r.headers();
    if (h.authorization) authHeaders.push(r.url());
  });
  await openApp(page);
  const accMock = await page.getByTestId("acc-value").getAttribute("data-value");
  const live = page.getByTestId("backend-live");
  await expect(live).not.toHaveAttribute("aria-disabled", "true");
  await live.click();
  await expect(page.getByTestId("backend-chip")).toContainText("fake-lexsim · live");
  await waitForRun(page);
  // the fake upstream is the mock, so a complete LIVE run matches MOCK exactly
  await expect(page.getByTestId("failed-badge")).toHaveCount(0);
  expect(await page.getByTestId("acc-value").getAttribute("data-value")).toBe(accMock);
  await expect(page.getByTestId("spend")).toContainText(/spent \$0\.0[1-9]/);
  await expect(page.getByTestId("mock-watermark")).toHaveCount(0);

  // the rerun runs out of budget part way
  await demoEdit(page);
  const badge = page.getByTestId("failed-badge");
  await expect(badge).toContainText("failed");
  await expect(badge).toContainText("spend cap reached");
  const failed = Number((await badge.textContent())!.match(/(\d+) failed/)![1]);
  expect(failed).toBeGreaterThan(0);
  expect(failed).toBeLessThan(N_DEV);
  await expect(page.getByTestId("partial-badge")).toContainText(`${N_DEV - failed} of ${N_DEV} scored`);
  await expect(page.getByTestId("failed-note")).toContainText("CROSSTALK_BUDGET_USD");
  await expect(page.getByTestId("retry-failed")).toBeVisible();
  await expect(page.getByTestId("history-partial")).toBeVisible();
  const c = await counts(page);
  expect(c.fixed + c.broke + c.unchanged).toBe(N_DEV - failed);
  // the toast is a sentence, never raw JSON
  await expect(page.getByRole("alert").first()).toContainText("spend cap");
  await expect(page.getByRole("alert").first()).not.toContainText("{");

  // retrying still hits the cap: the run stays partial and nothing is double counted
  await page.getByTestId("retry-failed").click();
  await waitForRun(page);
  await expect(page.getByTestId("failed-badge")).toBeVisible();

  // the key never passes through the browser
  expect(authHeaders).toEqual([]);
});
