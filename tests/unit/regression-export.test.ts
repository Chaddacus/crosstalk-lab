/**
 * The exported regression file is executed, not just counted: it is written into tests/unit/, run in a child
 * Vitest process, and must pass. A copy with a wrong gold must fail. The LIVE variant runs against a real local
 * server (the Hono app on a free port) whose upstream is the lexical mock, so no key and no money are involved.
 */
import { spawn } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { afterAll, describe, expect, it } from "vitest";
import { exportRegressions } from "../../src/core/eval/export.ts";
import { diffRuns } from "../../src/core/eval/diff.ts";
import { scoreRun } from "../../src/core/eval/metrics.ts";
import { createMockBackend, MOCK_MODEL } from "../../src/core/jev/mock-lexsim.ts";
import { choiceToWire } from "../../src/core/jev/wire.ts";
import type { DecideRequest } from "../../src/core/jev/types.ts";
import { runItems } from "../../src/core/run/runner.ts";
import { criteriaHash, textsFromChoiceCriteria, toChoiceCriteria } from "../../src/core/data/criteria.ts";
import { parseJsonl } from "../../src/core/data/splits.ts";
import type { Catalog } from "../../src/core/data/catalog.ts";
import { createLiveApp } from "../../server/live.ts";
import { resolvePreset } from "../../server/presets.ts";

const DIR = "data/twilio-v2010";
const catalog: Catalog = JSON.parse(readFileSync(`${DIR}/catalog.json`, "utf8"));
const dev = parseJsonl(readFileSync(`${DIR}/dev.jsonl`, "utf8"));
const v0 = JSON.parse(readFileSync(`${DIR}/criteria.v0.json`, "utf8"));
const demo = JSON.parse(readFileSync("tests/e2e/demo.json", "utf8")) as { edits: Record<string, { what?: string; not_for?: string }> };

const written: string[] = [];
afterAll(() => {
  for (const f of written) rmSync(f, { force: true });
});

/** Run one generated file in a child Vitest process (async, so a server in this process can answer it). */
async function runGenerated(content: string, env: Record<string, string> = {}) {
  const file = `tests/unit/zz-generated-${process.pid}-${written.length}.test.ts`;
  written.push(file);
  writeFileSync(file, content);
  try {
    return await new Promise<{ status: number | null; out: string }>((resolve) => {
      const child = spawn(process.execPath, ["node_modules/vitest/vitest.mjs", "run", file], {
        env: { ...process.env, ...env, FORCE_COLOR: "0", NO_COLOR: "1" },
      });
      let out = "";
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (out += d));
      child.on("close", (status) => resolve({ status, out }));
    });
  } finally {
    rmSync(file, { force: true });
  }
}

async function demoFixed() {
  const texts = textsFromChoiceCriteria(v0);
  for (const [op, t] of Object.entries(demo.edits)) texts[op] = { ...texts[op], ...t };
  const v1 = toChoiceCriteria(catalog.operations, texts);
  const run = async (c: typeof v0) => runItems({ backend: createMockBackend(), items: dev, criteria: c, criteriaHash: await criteriaHash(c), model: MOCK_MODEL, split: "dev" });
  const d = diffRuns(scoreRun(dev, await run(v0)), scoreRun(dev, await run(v1)));
  return { v1, fixed: d.flipped.filter((f) => f.status === "fixed").map((f) => ({ id: f.id, query: f.query, gold: f.gold })) };
}

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const port = (s.address() as AddressInfo).port;
      s.close(() => resolve(port));
    });
  });
}

describe("the exported regression file runs", () => {
  it("MOCK: the demo edit's fixed items pass; a wrong gold fails", async () => {
    const { v1, fixed } = await demoFixed();
    expect(fixed.length).toBeGreaterThan(0);
    const f = exportRegressions({ version: "v1", criteria: v1, fixed, backend: "mock", model: MOCK_MODEL });
    const ok = await runGenerated(f.content);
    expect(ok.status, ok.out).toBe(0);
    expect(ok.out).toMatch(new RegExp(`${fixed.length} passed`));
    const wrong = exportRegressions({ version: "v1", criteria: v1, fixed: [{ ...fixed[0]!, gold: "ListCall" }], backend: "mock", model: MOCK_MODEL });
    const bad = await runGenerated(wrong.content);
    expect(bad.status).not.toBe(0);
    expect(bad.out).toMatch(/1 failed/);
  }, 120_000);

  it("REPLAY: runs against the committed fixtures (never the mock)", async () => {
    const { v1, fixed } = await demoFixed();
    const f = exportRegressions({ version: "v1", criteria: v1, fixed, backend: "replay", model: MOCK_MODEL });
    expect(f.content).toContain("createReplayBackend(loadReplayStore())");
    expect(f.content).not.toContain("createMockBackend");
    const ok = await runGenerated(f.content);
    expect(ok.status, ok.out).toBe(0);
    expect(ok.out).toMatch(new RegExp(`${fixed.length} passed`));
  }, 120_000);

  it("LIVE: skipped without the opt-in flag; with it, repeats against the local server and passes", async () => {
    const { v1, fixed } = await demoFixed();
    const model = "fake-lexsim";
    const f = exportRegressions({ version: "v1", criteria: v1, fixed, backend: "http", model });
    expect(f.content).not.toContain("createMockBackend");
    const skipped = await runGenerated(f.content, { CROSSTALK_LIVE_TESTS: "" });
    expect(skipped.status, skipped.out).toBe(0);
    expect(skipped.out).toMatch(/skipped/);

    const port = await freePort();
    const mock = createMockBackend();
    let upstreamCalls = 0;
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      upstreamCalls++;
      const req = JSON.parse(String(init.body)) as DecideRequest;
      const res = await mock.decide(req);
      const [qid, d] = Object.entries(res.decisions)[0]!;
      if (d.kind !== "choice") throw new Error("choice only");
      return new Response(JSON.stringify(choiceToWire(req.model, qid, d, res.usage.inputTokens)), { status: 200 });
    }) as unknown as typeof fetch;
    const preset = resolvePreset({ CROSSTALK_PRESET: "compat", CROSSTALK_COMPAT_URL: "http://fake-upstream.invalid", CROSSTALK_MODEL: model } as NodeJS.ProcessEnv);
    const cacheDir = `test-results/regression-live-cache-${process.pid}`;
    const { app } = createLiveApp({ preset, budgetUsd: 1, port, cacheDir, fetch: fakeFetch, log: () => {}, requestsPerMinute: 60_000 });
    const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port });
    try {
      const live = await runGenerated(f.content, { CROSSTALK_LIVE_TESTS: "1", CROSSTALK_PROXY_URL: `http://127.0.0.1:${port}`, CROSSTALK_REPEATS: "2", CROSSTALK_MIN_WINS: "2" });
      expect(live.status, live.out).toBe(0);
      expect(live.out).toMatch(new RegExp(`${fixed.length} passed`));
      // the first call per case may be cached; the repeat bypasses the cache: 2 upstream calls per case
      expect(upstreamCalls).toBe(2 * fixed.length);
    } finally {
      server.close();
      rmSync(cacheDir, { recursive: true, force: true });
    }
  }, 120_000);
});
