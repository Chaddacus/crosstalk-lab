import { defineConfig, devices } from "@playwright/test";

/**
 * Uses the locally installed Google Chrome (channel "chrome"), so no browser download is needed.
 *
 * Every run starts its own servers on dedicated ports (never the 4173 that `npm start` uses), so the tests
 * always run against a fresh build. Set PW_REUSE=1 to reuse servers you started yourself on these ports.
 *
 *   desktop  the static build (MOCK and REPLAY), port 4273
 *   live     the LIVE path end to end: Vite dev (5273) → local live server (8887) → fake upstream (8890).
 *            The fake upstream is the lexical mock behind HTTP (not Jev); no key and no money are involved.
 *            The server's spend cap is set so the second rerun runs out of budget part way, on purpose.
 */
const PREVIEW = 4273;
const DEV = 5273;
const LIVE = 8887;
const FAKE = 8890;
const reuse = process.env.PW_REUSE === "1";
// a fresh response cache per run, so the budget scenario is the same every time
const liveCache = `test-results/live-cache/${Date.now()}`;

export default defineConfig({
  testDir: "tests/e2e",
  outputDir: process.env.PW_OUTPUT ?? "test-results/pw",
  timeout: 60_000,
  expect: { timeout: 15_000, toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: "disabled" } },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    channel: "chrome",
    reducedMotion: "reduce",
    acceptDownloads: true,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop",
      testIgnore: /live\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], channel: "chrome", viewport: { width: 1440, height: 900 }, baseURL: `http://127.0.0.1:${PREVIEW}` },
    },
    {
      name: "live",
      testMatch: /live\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], channel: "chrome", viewport: { width: 1440, height: 900 }, baseURL: `http://127.0.0.1:${DEV}` },
    },
  ],
  webServer: [
    {
      command: `npm run build && npx vite preview --port ${PREVIEW} --strictPort`,
      url: `http://127.0.0.1:${PREVIEW}`,
      reuseExistingServer: reuse,
      timeout: 180_000,
    },
    {
      command: "npx tsx scripts/fake-upstream.ts",
      port: FAKE,
      env: { FAKE_UPSTREAM_PORT: String(FAKE), FAKE_UPSTREAM_DELAY_MS: "5" },
      reuseExistingServer: reuse,
      timeout: 60_000,
    },
    {
      command: "npx tsx server/main.ts",
      url: `http://127.0.0.1:${LIVE}/api/health`,
      env: {
        CROSSTALK_PRESET: "compat",
        CROSSTALK_COMPAT_URL: `http://127.0.0.1:${FAKE}`,
        CROSSTALK_MODEL: "fake-lexsim",
        CROSSTALK_PORT: String(LIVE),
        CROSSTALK_WEB_ORIGINS: `http://127.0.0.1:${DEV}`,
        CROSSTALK_BUDGET_USD: "0.08",
        CROSSTALK_RPM: "12000",
        CROSSTALK_CACHE_DIR: liveCache,
      },
      reuseExistingServer: reuse,
      timeout: 60_000,
    },
    {
      command: `npx vite --port ${DEV} --strictPort`,
      url: `http://127.0.0.1:${DEV}`,
      env: { CROSSTALK_PORT: String(LIVE) },
      reuseExistingServer: reuse,
      timeout: 120_000,
    },
  ],
});
