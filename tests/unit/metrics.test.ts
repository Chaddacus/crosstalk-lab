import { describe, expect, it } from "vitest";
import { accuracy, gate, reliability, riskWeighted, type Scored, scoreRun, selective, wilson } from "../../src/core/eval/metrics.ts";
import { computeLeakage } from "../../src/core/eval/leakage.ts";
import { diffRuns } from "../../src/core/eval/diff.ts";
import type { RunRecord } from "../../src/core/run/runner.ts";
import type { Item } from "../../src/core/data/splits.ts";

// Expected values below are computed in this file, independently of the code under test.
function wilsonByHand(k: number, n: number, z: number) {
  const p = k / n;
  const a = p + (z * z) / (2 * n);
  const b = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n);
  const c = 1 + (z * z) / n;
  return { lo: (a - b) / c, hi: (a + b) / c };
}

describe("Wilson interval", () => {
  it("matches the closed form", () => {
    for (const [k, n] of [
      [0, 10],
      [3, 7],
      [50, 100],
      [179, 180],
    ] as const) {
      const w = wilson(k, n);
      const e = wilsonByHand(k, n, 1.96);
      expect(w.lo).toBeCloseTo(Math.max(0, e.lo), 12);
      expect(w.hi).toBeCloseTo(Math.min(1, e.hi), 12);
    }
  });

  it("matches a hand-worked case: 8 of 10 → [0.4902, 0.9433]", () => {
    const w = wilson(8, 10);
    expect(w.p).toBe(0.8);
    expect(w.lo).toBeCloseTo(0.490157, 5);
    expect(w.hi).toBeCloseTo(0.943319, 5);
  });

  it("is [0, 1] with no data", () => {
    expect(wilson(0, 0)).toMatchObject({ lo: 0, hi: 1 });
  });
});

const item = (id: string, gold: string): Item => ({ id, query: `q ${id}`, gold, kind: gold === "none_of_these" ? "no_match" : "match", persona: "developer", family: "F" });

function run(options: string[], rows: [string, string, number[]][]): RunRecord {
  return {
    kind: "crosstalk-run",
    criteriaHash: "c",
    backend: "mock",
    backendLabel: "mock",
    model: "m",
    split: "dev",
    options,
    results: rows.map(([id, chosen, probs]) => ({
      id,
      chosen,
      probs,
      confidence: (options.length * Math.max(...probs) - 1) / (options.length - 1),
      confidenceSource: "derived",
      inputTokens: 1,
      costUsd: 0,
      costSource: "estimated",
      cached: false,
    })),
    startedAt: "",
    wallMs: 0,
    runHash: "r",
    errors: 0,
    inputTokens: 0,
    costUsd: 0,
    costSource: "estimated",
  };
}

describe("leaked mass on a 3-option toy set", () => {
  const options = ["A", "B", "none_of_these"];
  const items = [item("d-0001", "A"), item("d-0002", "B"), item("d-0003", "A")];
  const r = run(options, [
    ["d-0001", "A", [0.7, 0.2, 0.1]],
    ["d-0002", "A", [0.5, 0.4, 0.1]], // error: gold B predicted A
    ["d-0003", "A", [0.55, 0.4, 0.05]], // correct, runner-up B, margin 0.15 < 0.2
  ]);
  const leak = computeLeakage(items, r);
  const ab = leak.pairs.find((p) => p.key === "A|B")!;

  it("sums p(other) over items whose gold is either side", () => {
    expect(ab.ab).toBeCloseTo(0.2 + 0.4, 12); // gold A → p(B)
    expect(ab.ba).toBeCloseTo(0.5, 12); // gold B → p(A)
    expect(ab.mass).toBeCloseTo(1.1, 12);
    expect(leak.pairs.find((p) => p.key === "A|none_of_these")!.mass).toBeCloseTo(0.15, 12);
    expect(leak.pairs.find((p) => p.key === "B|none_of_these")!.mass).toBeCloseTo(0.1, 12);
    expect(leak.total).toBeCloseTo(0.3 + 0.6 + 0.45, 12);
  });

  it("classifies the pair state and keeps the worst item", () => {
    expect(ab.errors).toBe(1);
    expect(ab.nearMiss).toBe(1);
    expect(ab.state).toBe("error");
    expect(ab.worst).toMatchObject({ id: "d-0002", gold: "B", other: "A", leak: 0.5 });
    expect(leak.pairs[0]!.key).toBe("A|B");
    expect(leak.pairs.find((p) => p.key === "A|none_of_these")!.hub).toBe(true);
  });

  it("marks a near-miss-only pair as near", () => {
    const r2 = run(options, [["d-0003", "A", [0.55, 0.4, 0.05]]]);
    expect(computeLeakage([items[2]!], r2).pairs.find((p) => p.key === "A|B")!.state).toBe("near");
  });
});

const s = (id: string, correct: boolean, confidence: number, chosen = correct ? "G" : "X", gold = "G", pGold = correct ? 0.9 : 0.1): Scored => ({
  id,
  query: id,
  gold,
  kind: "match",
  family: "F",
  chosen,
  correct,
  error: false,
  pGold,
  pTop: confidence,
  runnerUp: null,
  margin: 0.5,
  confidence,
  confidenceSource: "derived",
});

describe("diff, risk, selective, reliability, gate", () => {
  it("classifies fixed, broke and unchanged", () => {
    const before = [s("1", false, 0.5), s("2", true, 0.5), s("3", true, 0.5), s("4", false, 0.5)];
    const after = [s("1", true, 0.5), s("2", false, 0.5), s("3", true, 0.5), s("4", false, 0.5)];
    const d = diffRuns(before, after);
    expect([d.fixed, d.broke, d.unchanged, d.errors]).toEqual([1, 1, 2, 0]);
    expect(d.fixed + d.broke + d.unchanged).toBe(4);
    expect(d.flipped.map((x) => x.status)).toEqual(["broke", "fixed"]);
    expect(d.items[0]!.dpGold).toBeCloseTo(0.8, 12);
  });

  it("weights wrong DELETE picks by w", () => {
    const del = new Set(["DeleteCall"]);
    const xs = [s("1", true, 0.9), s("2", false, 0.9, "DeleteCall"), s("3", false, 0.9, "FetchCall"), s("4", true, 0.9)];
    const r = riskWeighted(xs, del, 10);
    expect(r.mean).toBeCloseTo((10 + 1) / 4, 12);
    expect(r.per100).toBeCloseTo(275, 9);
    expect(r.wrongDelete).toBe(1);
  });

  it("computes AURC on a toy set", () => {
    // sorted by confidence: correct, wrong, correct, wrong → risks 0, 1/2, 1/3, 1/2
    const xs = [s("a", true, 0.9), s("b", false, 0.8), s("c", true, 0.7), s("d", false, 0.6)];
    expect(selective(xs).aurc).toBeCloseTo((0 + 0.5 + 1 / 3 + 0.5) / 4, 12);
  });

  it("computes ECE on a toy set", () => {
    const xs = [s("a", true, 0.95), s("b", false, 0.95), s("c", true, 0.15), s("d", false, 0.15)];
    // bin 0.9–1.0: |0.5 − 0.95| × 2/4; bin 0.1–0.2: |0.5 − 0.15| × 2/4
    expect(reliability(xs).ece).toBeCloseTo(0.45 * 0.5 + 0.35 * 0.5, 12);
  });

  it("gate coverage falls as τ rises (monotonic)", () => {
    const xs = Array.from({ length: 50 }, (_, i) => s(`i${i}`, i % 3 !== 0, (i + 0.5) / 50));
    let last = 2;
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const g = gate(xs, t, new Set(), 10);
      expect(g.coverage).toBeLessThanOrEqual(last);
      last = g.coverage;
    }
  });

  it("scores a run: accuracy by kind, margin and runner-up", () => {
    const options = ["A", "B", "none_of_these"];
    const items = [item("d-0001", "A"), item("d-0002", "none_of_these")];
    const sc = scoreRun(items, run(options, [["d-0001", "A", [0.6, 0.3, 0.1]], ["d-0002", "B", [0.2, 0.5, 0.3]]]));
    expect(sc[0]).toMatchObject({ correct: true, runnerUp: "B" });
    expect(sc[0]!.margin).toBeCloseTo(0.3, 12);
    const a = accuracy(sc);
    expect([a.all.k, a.all.n, a.match.k, a.noMatch.k, a.noMatch.n]).toEqual([1, 2, 1, 0, 1]);
  });
});

describe("leaked mass: every contribution counts", () => {
  const options = ["A", "B", "C", "none_of_these"];
  const items = [item("d-0001", "A"), item("d-0002", "B"), item("d-0003", "C")];
  // p(C) for gold A is 0.0004 (under eps 1e-3): it still counts toward M(A, C) and the total
  const r = run(options, [
    ["d-0001", "A", [0.9, 0.0996, 0.0004, 0]],
    ["d-0002", "B", [0.3, 0.6, 0.0002, 0.0998]],
    ["d-0003", "C", [0.0008, 0.0003, 0.9989, 0]],
  ]);
  const leak = computeLeakage(items, r);

  it("listed pair masses plus the omitted mass add up to the total leak", () => {
    const listed = leak.pairs.reduce((a, p) => a + p.mass, 0);
    // independent total: Σ (1 − p(gold))
    const total = 1 - 0.9 + (1 - 0.6) + (1 - 0.9989);
    expect(leak.total).toBeCloseTo(total, 12);
    expect(listed + leak.omitted.mass).toBeCloseTo(total, 12);
  });

  it("includes a sub-eps contribution in the pair's mass but not in its item count", () => {
    const ac = leak.pairs.find((p) => p.key === "A|C")!;
    expect(ac.mass).toBeCloseTo(0.0004 + 0.0008, 12);
    expect(ac.n).toBe(0);
    // B|C = 0.0002 + 0.0003 < eps, no error: not listed, kept in `omitted`
    expect(leak.pairs.find((p) => p.key === "B|C")).toBeUndefined();
    expect(leak.omitted.pairs).toBe(1);
    expect(leak.omitted.mass).toBeCloseTo(0.0005, 12);
  });
});

describe("errored items are never right, wrong or covered", () => {
  const options = ["A", "B", "none_of_these"];
  const items = [item("d-0001", "A"), item("d-0002", "B"), item("d-0003", "A"), item("d-0004", "B")];
  const ok = run(options, [
    ["d-0001", "A", [0.8, 0.1, 0.1]],
    ["d-0002", "A", [0.6, 0.3, 0.1]],
    ["d-0003", "A", [0.9, 0.05, 0.05]],
    ["d-0004", "B", [0.1, 0.8, 0.1]],
  ]);
  const withErrors: RunRecord = {
    ...ok,
    errors: 2,
    results: ok.results.map((x) => (x.id === "d-0003" || x.id === "d-0004" ? { ...x, chosen: null, probs: null, confidence: null, confidenceSource: "none" as const, error: { code: "budget", message: "cap" } } : x)),
  };
  const sOk = scoreRun(items, ok);
  const sErr = scoreRun(items, withErrors);

  it("accuracy counts only answered items, and reports the errors", () => {
    const a = accuracy(sErr);
    expect([a.all.k, a.all.n, a.errors, a.n]).toEqual([1, 2, 2, 4]);
  });

  it("the diff marks them error, never fixed, broke or unchanged", () => {
    const d = diffRuns(sOk, sErr);
    expect([d.fixed, d.broke, d.unchanged, d.errors]).toEqual([0, 0, 2, 2]);
    expect(d.flipped).toEqual([]);
  });

  it("risk ignores them; the gate sends them to HUMAN; leakage skips them", () => {
    const risk = riskWeighted(sErr, new Set(["A"]), 10);
    expect(risk.mean).toBeCloseTo(10 / 2, 12); // one wrong DELETE-like pick (A) out of two answered
    const g = gate(sErr, 0, new Set(), 10);
    expect([g.nAuto, g.nHuman]).toEqual([2, 2]);
    expect(g.coverage).toBeCloseTo(0.5, 12);
    expect(computeLeakage(items, withErrors).total).toBeCloseTo(0.2 + 0.7, 12);
  });

  it("the coverage curve uses the gate's population (errors are never covered)", () => {
    const sel = selective(sErr);
    expect(sel.total).toBe(4);
    expect(sel.answered).toBe(2);
    expect(sel.curve[sel.curve.length - 1]!.coverage).toBeCloseTo(gate(sErr, 0, new Set(), 10).coverage, 12);
  });
});
