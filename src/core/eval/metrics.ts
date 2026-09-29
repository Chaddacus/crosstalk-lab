/**
 * Metrics over one run. Pure TypeScript. Error items are excluded from rates and counted separately.
 */
import { NONE } from "../data/catalog.ts";
import type { Item } from "../data/splits.ts";
import type { RunRecord } from "../run/runner.ts";

export interface Interval {
  k: number;
  n: number;
  p: number;
  lo: number;
  hi: number;
}

/** Wilson score interval, closed form. z = 1.96 gives 95%. */
export function wilson(k: number, n: number, z = 1.96): Interval {
  if (n === 0) return { k, n, p: NaN, lo: 0, hi: 1 };
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { k, n, p, lo: Math.max(0, center - half), hi: Math.min(1, center + half) };
}

export interface Scored {
  id: string;
  query: string;
  gold: string;
  kind: Item["kind"];
  family: string;
  chosen: string | null;
  correct: boolean;
  error: boolean;
  pGold: number;
  pTop: number;
  /** Option with the second-highest probability. */
  runnerUp: string | null;
  /** p(top-1) − p(top-2). */
  margin: number;
  confidence: number;
  confidenceSource: string;
}

export function scoreRun(items: Item[], run: RunRecord): Scored[] {
  const byId = new Map(run.results.map((r) => [r.id, r]));
  const goldIndex = new Map(run.options.map((o, i) => [o, i]));
  return items.flatMap((it): Scored[] => {
    const r = byId.get(it.id);
    if (!r) return [];
    if (r.error || !r.probs || !r.chosen) {
      return [{ id: it.id, query: it.query, gold: it.gold, kind: it.kind, family: it.family, chosen: null, correct: false, error: true, pGold: NaN, pTop: NaN, runnerUp: null, margin: NaN, confidence: NaN, confidenceSource: "none" }];
    }
    let i1 = -1;
    let i2 = -1;
    r.probs.forEach((p, i) => {
      if (i1 < 0 || p > r.probs![i1]!) {
        i2 = i1;
        i1 = i;
      } else if (i2 < 0 || p > r.probs![i2]!) i2 = i;
    });
    const gi = goldIndex.get(it.gold);
    const pTop = r.probs[i1]!;
    return [
      {
        id: it.id,
        query: it.query,
        gold: it.gold,
        kind: it.kind,
        family: it.family,
        chosen: r.chosen,
        correct: r.chosen === it.gold,
        error: false,
        pGold: gi === undefined ? 0 : r.probs[gi]!,
        pTop,
        runnerUp: i2 >= 0 ? run.options[i2]! : null,
        margin: i2 >= 0 ? pTop - r.probs[i2]! : pTop,
        confidence: r.confidence ?? pTop,
        confidenceSource: r.confidenceSource,
      },
    ];
  });
}

export interface AccuracyReport {
  n: number;
  errors: number;
  all: Interval;
  match: Interval;
  noMatch: Interval;
}

export function accuracy(scored: Scored[]): AccuracyReport {
  const ok = scored.filter((s) => !s.error);
  const m = ok.filter((s) => s.gold !== NONE);
  const nm = ok.filter((s) => s.gold === NONE);
  const c = (xs: Scored[]) => xs.filter((s) => s.correct).length;
  return {
    n: scored.length,
    errors: scored.length - ok.length,
    all: wilson(c(ok), ok.length),
    match: wilson(c(m), m.length),
    noMatch: wilson(c(nm), nm.length),
  };
}

/** Cost of one wrong pick: w when the picked operation is a DELETE, else 1. Correct picks cost 0. */
export function pickCost(s: Scored, deleteOps: Set<string>, w: number): number {
  if (s.error || s.correct) return 0;
  return s.chosen && deleteOps.has(s.chosen) ? w : 1;
}

export interface RiskReport {
  /** Mean cost per (non-error) item. */
  mean: number;
  per100: number;
  wrong: number;
  wrongDelete: number;
}

export function riskWeighted(scored: Scored[], deleteOps: Set<string>, w = 10): RiskReport {
  const ok = scored.filter((s) => !s.error);
  const total = ok.reduce((a, s) => a + pickCost(s, deleteOps, w), 0);
  const mean = ok.length ? total / ok.length : NaN;
  return {
    mean,
    per100: mean * 100,
    wrong: ok.filter((s) => !s.correct).length,
    wrongDelete: ok.filter((s) => !s.correct && s.chosen && deleteOps.has(s.chosen)).length,
  };
}

function byConfidenceDesc(scored: Scored[]): Scored[] {
  return scored.filter((s) => !s.error).sort((a, b) => b.confidence - a.confidence || (a.id < b.id ? -1 : 1));
}

export interface SelectiveReport {
  curve: { coverage: number; accuracy: number; confidence: number }[];
  /** Area under the risk–coverage curve: mean of the error rate of the top-i items, i = 1..n. Lower is better. */
  aurc: number;
}

export function selective(scored: Scored[]): SelectiveReport {
  const s = byConfidenceDesc(scored);
  let correct = 0;
  let riskSum = 0;
  const curve: SelectiveReport["curve"] = [];
  s.forEach((x, i) => {
    if (x.correct) correct++;
    const acc = correct / (i + 1);
    riskSum += 1 - acc;
    curve.push({ coverage: (i + 1) / s.length, accuracy: acc, confidence: x.confidence });
  });
  return { curve, aurc: s.length ? riskSum / s.length : NaN };
}

export interface ReliabilityReport {
  bins: { lo: number; hi: number; n: number; confidence: number; accuracy: number }[];
  /** Expected calibration error, weighted by bin counts. */
  ece: number;
}

export function reliability(scored: Scored[], nBins = 10): ReliabilityReport {
  const ok = scored.filter((s) => !s.error);
  const bins = Array.from({ length: nBins }, (_, i) => ({ lo: i / nBins, hi: (i + 1) / nBins, n: 0, sumConf: 0, sumAcc: 0 }));
  for (const s of ok) {
    const b = Math.min(nBins - 1, Math.max(0, Math.floor(s.confidence * nBins)));
    bins[b]!.n++;
    bins[b]!.sumConf += s.confidence;
    bins[b]!.sumAcc += s.correct ? 1 : 0;
  }
  let ece = 0;
  const out = bins.map((b) => {
    const conf = b.n ? b.sumConf / b.n : NaN;
    const acc = b.n ? b.sumAcc / b.n : NaN;
    if (b.n) ece += (b.n / ok.length) * Math.abs(acc - conf);
    return { lo: b.lo, hi: b.hi, n: b.n, confidence: conf, accuracy: acc };
  });
  return { bins: out, ece: ok.length ? ece : NaN };
}

export interface GateReport {
  tau: number;
  /** Share of all items (errors included) that go to the AUTO lane. */
  coverage: number;
  nAuto: number;
  nHuman: number;
  auto: Interval;
  confidentErrors: number;
  riskConfidentErrors: number;
}

/** AUTO when confidence ≥ τ. Error items always go to HUMAN (fail safe). */
export function gate(scored: Scored[], tau: number, deleteOps: Set<string>, w = 10): GateReport {
  const auto = scored.filter((s) => !s.error && s.confidence >= tau);
  const wrong = auto.filter((s) => !s.correct);
  return {
    tau,
    coverage: scored.length ? auto.length / scored.length : 0,
    nAuto: auto.length,
    nHuman: scored.length - auto.length,
    auto: wilson(auto.length - wrong.length, auto.length),
    confidentErrors: wrong.length,
    riskConfidentErrors: wrong.reduce((a, s) => a + pickCost(s, deleteOps, w), 0),
  };
}

export function totalLeak(scored: Scored[]): number {
  return scored.filter((s) => !s.error).reduce((a, s) => a + (1 - s.pGold), 0);
}
