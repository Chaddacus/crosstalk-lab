import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Catalog } from "../../src/core/data/catalog.ts";
import { parseJsonl, type Manifest } from "../../src/core/data/splits.ts";
import { crossSplitOverlap, isSpecEcho, lintSplit, privacyProblems } from "../../src/core/data/lint.ts";
import { textsFromSpec, toChoiceCriteria, textsFromChoiceCriteria } from "../../src/core/data/criteria.ts";
import { loadSealedSplit, memoryLedger, recordPeek } from "../../src/core/eval/seal.ts";
import { SealError, BudgetExceeded, CrosstalkError } from "../../src/core/jev/errors.ts";
import { Budget } from "../../src/core/run/budget.ts";
import { createLimiter } from "../../src/core/run/limiter.ts";
import { priorityOrder, runItems } from "../../src/core/run/runner.ts";
import { createMockBackend } from "../../src/core/jev/mock-lexsim.ts";
import { exportCriteria, exportRegressions } from "../../src/core/eval/export.ts";
import type { DecisionBackend } from "../../src/core/jev/types.ts";

const DIR = "data/twilio-v2010";
const catalog: Catalog = JSON.parse(readFileSync(`${DIR}/catalog.json`, "utf8"));
const manifest: Manifest = JSON.parse(readFileSync(`${DIR}/MANIFEST.json`, "utf8"));
const dev = parseJsonl(readFileSync(`${DIR}/dev.jsonl`, "utf8"));
const testBytes = readFileSync(`${DIR}/test.jsonl`);
const test = parseJsonl(testBytes.toString("utf8"));

describe("catalog", () => {
  it("has the counts verified against the pinned spec", () => {
    const ops = catalog.operations;
    const m = (x: string) => ops.filter((o) => o.method === x).length;
    expect(ops).toHaveLength(197);
    expect(catalog.families).toHaveLength(22);
    expect([m("GET"), m("POST"), m("DELETE")]).toEqual([103, 62, 32]);
    expect(ops.filter((o) => o.empty)).toHaveLength(47);
    expect(new Set(ops.map((o) => o.tag)).size).toBe(75);
    expect(catalog.source.sha256).toBe("78e76cc93c355a259e241866c241663eddb6ce0ed528f066c6cf0958648f5637");
  });

  it("criteria.v0.json is derived from the spec only", () => {
    const v0 = JSON.parse(readFileSync(`${DIR}/criteria.v0.json`, "utf8"));
    expect(v0).toEqual(toChoiceCriteria(catalog.operations, textsFromSpec(catalog.operations)));
    expect(Object.keys(v0)).toHaveLength(198);
    expect(toChoiceCriteria(catalog.operations, textsFromChoiceCriteria(v0))).toEqual(v0);
  });
});

describe("data lint", () => {
  for (const [name, items] of [
    ["dev", dev],
    ["test", test],
  ] as const) {
    it(`${name}: golds, ids, no-match share, privacy`, () => {
      const r = lintSplit(catalog.operations, items);
      expect(r.errors).toEqual([]);
      expect(r.stats.noMatchShare).toBeGreaterThanOrEqual(0.25);
      expect(r.stats.noMatchShare).toBeLessThanOrEqual(0.35);
      expect(r.stats.distinctOps).toBeGreaterThanOrEqual(100);
      console.log(`${name} spec-echo rate: ${(r.stats.specEchoRate * 100).toFixed(1)}%`);
    });
  }

  it("no query is in both dev and test (exact or normalized)", () => {
    expect(crossSplitOverlap(dev, test)).toEqual([]);
  });

  it("flags real-looking PII and allows the fictional patterns", () => {
    expect(privacyProblems("Call +1 415 555 0142 or email ops@example.com from 192.0.2.10")).toEqual([]);
    expect(privacyProblems("Call +1 415 867 5309")).toHaveLength(1);
    expect(privacyProblems("mail jane@gmail.com")).toHaveLength(1);
    expect(privacyProblems("call CA0123456789abcdef0123456789abcdef")).toHaveLength(1);
    expect(privacyProblems("allow 8.8.8.8")).toHaveLength(1);
  });

  it("detects spec echo", () => {
    expect(isSpecEcho({ gold: "ListSigningKey", query: "List our signing keys." })).toBe(true);
    expect(isSpecEcho({ gold: "UpdateCall", query: "Hang up call CAxxxx0042 now." })).toBe(false);
  });
});

describe("seal", () => {
  const read = async () => testBytes;

  it("the committed test file matches the manifest hash", () => {
    expect(createHash("sha256").update(testBytes).digest("hex")).toBe(manifest.splits.test!.sha256);
  });

  it("refuses without the unseal flag", async () => {
    await expect(loadSealedSplit({ unseal: false, manifest, read })).rejects.toBeInstanceOf(SealError);
  });

  it("refuses on a hash mismatch", async () => {
    const tampered = Buffer.concat([testBytes, Buffer.from("\n")]);
    await expect(loadSealedSplit({ unseal: true, manifest, read: async () => tampered })).rejects.toThrow(/hash mismatch/);
  });

  it("loads with the flag and each ledger append raises the peek count by 1", async () => {
    const { items } = await loadSealedSplit({ unseal: true, manifest, read });
    expect(items).toHaveLength(manifest.splits.test!.count);
    const store = memoryLedger();
    const row = { at: "t", split: "test" as const, testSha256: "x", criteriaHash: "c", backend: "mock", model: "m", n: 1, accuracy: 1, lo: 0, hi: 1, matchAccuracy: 1, noMatchAccuracy: 1, riskPer100: 0, errors: 0, where: "cli" as const };
    expect((await recordPeek(store, row)).peek).toBe(1);
    expect((await recordPeek(store, row)).peek).toBe(2);
    expect(await store.read()).toHaveLength(2);
  });
});

describe("budget and limiter", () => {
  it("refuses a request that would pass the cap", () => {
    const b = new Budget(0.001);
    const r1 = b.reserve(0.0006);
    expect(() => b.reserve(0.0006)).toThrow(BudgetExceeded);
    b.settle(r1, 0.0002);
    expect(() => b.reserve(0.0006)).not.toThrow();
    expect(b.spentUsd).toBeCloseTo(0.0002, 12);
  });

  it("spaces requests with a fake clock (60/min → one per second)", async () => {
    let t = 0;
    const starts: number[] = [];
    const lim = createLimiter({
      requestsPerMinute: 60,
      concurrency: 10,
      now: () => t,
      sleep: async (ms) => {
        t += ms;
      },
    });
    for (let i = 0; i < 4; i++) {
      const release = await lim.acquire();
      starts.push(t);
      release();
    }
    expect(starts).toEqual([0, 1000, 2000, 3000]);
  });

  it("caps concurrency", async () => {
    const lim = createLimiter({ requestsPerMinute: 1e9, burst: 100, concurrency: 2 });
    let active = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 8 }, async () => {
        const release = await lim.acquire();
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        release();
      }),
    );
    expect(peak).toBe(2);
  });
});

describe("runner", () => {
  const v0 = JSON.parse(readFileSync(`${DIR}/criteria.v0.json`, "utf8"));
  const items = dev.slice(0, 40);

  it("is deterministic: same criteria, same run hash", async () => {
    const a = await runItems({ backend: createMockBackend(), items, criteria: v0, criteriaHash: "h", model: "mock-lexsim-1", split: "dev" });
    const b = await runItems({ backend: createMockBackend(), items, criteria: v0, criteriaHash: "h", model: "mock-lexsim-1", split: "dev", order: [...items].reverse().map((i) => i.id) });
    expect(a.runHash).toBe(b.runHash);
    expect(a.results.map((r) => r.id)).toEqual(items.map((i) => i.id));
  });

  it("marks failed items as errors and never as right or wrong", async () => {
    const flaky: DecisionBackend = {
      kind: "mock",
      label: "flaky",
      async decide(req) {
        if (JSON.stringify(req.state).includes(items[3]!.query.slice(0, 10))) throw new CrosstalkError("boom", "boom");
        return createMockBackend().decide(req);
      },
    };
    const r = await runItems({ backend: flaky, items, criteria: v0, criteriaHash: "h", model: "m", split: "dev" });
    expect(r.errors).toBeGreaterThanOrEqual(1);
    expect(r.results.find((x) => x.id === items[3]!.id)).toMatchObject({ chosen: null, error: { code: "boom" } });
  });

  it("runs items with the most probability on edited options first", async () => {
    const prev = await runItems({ backend: createMockBackend(), items, criteria: v0, criteriaHash: "h", model: "m", split: "dev" });
    const order = priorityOrder(items, prev, ["UpdateCall"]);
    expect(order).toHaveLength(items.length);
    const idx = prev.options.indexOf("UpdateCall");
    const w = (id: string) => prev.results.find((r) => r.id === id)!.probs![idx]!;
    for (let i = 1; i < order.length; i++) expect(w(order[i - 1]!)).toBeGreaterThanOrEqual(w(order[i]!));
  });
});

describe("exports", () => {
  const v0 = JSON.parse(readFileSync(`${DIR}/criteria.v0.json`, "utf8"));
  it("criteria export validates against the wire schema", () => {
    const f = exportCriteria(v0, "v1", "jev-1.13.0");
    expect(f.filename).toBe("criteria.twilio-v2010.v1.json");
    expect(JSON.parse(f.content)).toEqual(v0);
  });

  it("regression export has one case per fixed item", () => {
    const f = exportRegressions({
      version: "v1",
      criteria: v0,
      backend: "mock",
      model: "mock-lexsim-1",
      fixed: [
        { id: "d-0001", query: "a", gold: "UpdateCall" },
        { id: "d-0002", query: "b", gold: "DeleteCall" },
      ],
    });
    expect(f.content.match(/\n {2}it\(/g)).toHaveLength(2);
    expect(f.content).toContain('toBe("DeleteCall")');
  });
});
