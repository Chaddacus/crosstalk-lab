/**
 * Store-level tests: the run controller and the guards around it, driven through the LIVE path with a stubbed
 * fetch (no Worker, no server). Covers: history clicks during a run, exports and the Gate refusing a
 * half-finished run, the sealed-test comparison never mixing criteria versions, runs keyed by the requested
 * model, partial runs retried item by item, and a run-level failure settling its promise.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMockBackend } from "../../src/core/jev/mock-lexsim.ts";
import { choiceToWire } from "../../src/core/jev/wire.ts";
import type { DecideRequest } from "../../src/core/jev/types.ts";
import { criteriaHash } from "../../src/core/data/criteria.ts";
import { runItems, type RunRecord } from "../../src/core/run/runner.ts";
import { criteriaV0, devItems } from "../../src/web/data.ts";
import { __test, runKey, startRun, useStore, viewVersionById, type Version } from "../../src/web/store.ts";
import { runIsFinal } from "../../src/web/analysis.ts";
import { sealComparison } from "../../src/web/seal/SealModal.tsx";

const initial = useStore.getState();
const realFetch = globalThis.fetch;
const mock = createMockBackend();
const items = devItems.slice(0, 12);

async function version(id: string, criteria = criteriaV0): Promise<Version> {
  return { id, n: Number(id.slice(1)), texts: {}, criteria, hash: await criteriaHash(criteria), parent: null, createdAt: 0, changed: [] };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** A stub of the local proxy: /api/health, and /api/systemone answered by the mock (as `reportedModel`). */
function stubProxy(o: { reportedModel?: string; failFirst?: number; hang?: boolean } = {}) {
  const calls: string[] = [];
  let failures = o.failFirst ?? 0;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith("/api/health")) return json({ live: true, preset: "compat", model: "jev-latest", budgetUsd: 1, spentUsd: 0, token: "t" });
    const req = JSON.parse(String(init!.body)) as DecideRequest;
    calls.push((req.state as { request: string }).request);
    if (o.hang) return new Promise<Response>(() => undefined);
    if (failures > 0) {
      failures--;
      return json({ error: "budget cap $0.08 would be passed", code: "budget" }, 402);
    }
    const res = await mock.decide(req);
    const [qid, d] = Object.entries(res.decisions)[0]!;
    if (d.kind !== "choice") throw new Error("choice only");
    return json(choiceToWire(o.reportedModel ?? req.model, qid, d, res.usage.inputTokens));
  }) as typeof fetch;
  return calls;
}

beforeEach(() => {
  useStore.setState({ ...initial, backend: "live", health: { live: true, model: "jev-latest", token: "t", budgetUsd: 1, spentUsd: 0 } }, true);
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("run controller", () => {
  it("keys a LIVE run by the requested model and keeps the reported one separately", async () => {
    stubProxy({ reportedModel: "jev-1.13.0-20260917" });
    const v0 = await version("v0");
    useStore.setState({ versions: [v0], currentId: "v0", viewId: "v0" });
    const rec = await startRun(v0, { baseKey: null, items });
    expect(rec.model).toBe("jev-latest");
    expect(rec.reportedModels).toEqual(["jev-1.13.0-20260917"]);
    const stored = useStore.getState().runs[runKey(v0.hash, "live", "dev", "jev-latest")];
    expect(stored).toBe(rec);
    expect(useStore.getState().toasts.some((t) => t.text.includes("jev-1.13.0-20260917"))).toBe(true);
  });

  it("refuses a second run while one is active, and a history click during a run changes nothing", async () => {
    stubProxy({ hang: true });
    const v0 = await version("v0");
    const v1 = await version("v1", { ...criteriaV0, none_of_these: "anything else" });
    useStore.setState({ versions: [v0, v1], currentId: "v1", viewId: "v1" });
    const first = startRun(v1, { baseKey: null, items });
    first.catch(() => undefined);
    await expect(startRun(v0, { baseKey: null, items })).rejects.toThrow(/already in progress/);
    viewVersionById("v0");
    expect(useStore.getState().viewId).toBe("v1");
    expect(useStore.getState().active?.versionId).toBe("v1");
    expect(useStore.getState().toasts.at(-1)?.text).toMatch(/run is in progress/);
    // a run-level failure settles the promise and clears the active run
    __test.fail(__test.ctl!.runId, "boom");
    await expect(first).rejects.toThrow("boom");
    expect(useStore.getState().active).toBeNull();
  });

  it("keeps a partial run, then reruns only its failed items and merges them (same hash as a clean run)", async () => {
    const calls = stubProxy({ failFirst: 5 });
    const v0 = await version("v0");
    useStore.setState({ versions: [v0], currentId: "v0", viewId: "v0" });
    const partial = await startRun(v0, { baseKey: null, items });
    expect(partial.errors).toBe(5);
    expect(partial.results.filter((r) => r.error).every((r) => r.error!.code === "budget")).toBe(true);
    expect(useStore.getState().toasts.some((t) => t.kind === "error" && t.text.includes("spend cap"))).toBe(true);
    calls.length = 0;
    const merged = await startRun(v0, { baseKey: null, items });
    expect(calls).toHaveLength(5);
    expect(merged.errors).toBe(0);
    expect(merged.results.map((r) => r.id)).toEqual(items.map((i) => i.id));
    const asHttp = { kind: "http" as const, label: "mock over http", decide: mock.decide.bind(mock) };
    const clean = await runItems({ backend: asHttp, items, criteria: criteriaV0, criteriaHash: v0.hash, model: "jev-latest", split: "dev" });
    expect(merged.runHash).toBe(clean.runHash);
    // a clean stored run is final: no more calls
    calls.length = 0;
    await startRun(v0, { baseKey: null, items });
    expect(calls).toHaveLength(0);
  });
});

describe("guards", () => {
  it("exports and the Gate accept only a finished run", () => {
    const run = { runHash: "abc" } as RunRecord;
    expect(runIsFinal(null, null)).toBe(false);
    expect(runIsFinal({ ...run, runHash: "" }, null)).toBe(false);
    expect(runIsFinal(run, { runId: 1 } as never)).toBe(false);
    expect(runIsFinal(run, null)).toBe(true);
  });

  it("the sealed-test comparison uses the dev run of the SAME criteria and marks it stale after an edit", async () => {
    const v0 = await version("v0");
    const v1 = await version("v1", { ...criteriaV0, none_of_these: "anything else" });
    const dev = (hash: string, id: string): RunRecord => ({ kind: "crosstalk-run", criteriaHash: hash, criteriaVersion: id, backend: "mock", backendLabel: "", model: "mock-lexsim-1", split: "dev", options: [], results: [], startedAt: "", wallMs: 0, runHash: id, errors: 0, inputTokens: 0, costUsd: 0, costSource: "estimated" });
    const dev0 = dev(v0.hash, "v0");
    const dev1 = dev(v1.hash, "v1");
    const test0: RunRecord = { ...dev0, split: "test", runHash: "t0" };
    useStore.setState({
      backend: "mock",
      versions: [v0, v1],
      currentId: "v1",
      viewId: "v1",
      runs: { [runKey(v0.hash, "mock", "dev")]: dev0, [runKey(v1.hash, "mock", "dev")]: dev1 },
      seal: { ...useStore.getState().seal, testRun: test0, testItems: [] },
    });
    const cmp = sealComparison(useStore.getState())!;
    expect(cmp.dev).toBe(dev0);
    expect(cmp.testLabel).toBe("v0");
    expect(cmp.stale).toBe(true);
    expect(cmp.currentLabel).toBe("v1");
  });
});
