/**
 * Leaked mass between option pairs: the soft confusion matrix from one run.
 *
 * M(a, b) = Σ p(b) over items whose gold is a  +  Σ p(a) over items whose gold is b.
 * Unit: "items' worth of probability". Pairs are unordered; `ab` and `ba` keep the directions.
 *
 * State of a pair:
 *   error       at least one item with gold in {a, b} was predicted as the other
 *   near        no error, but at least one item was correct with the other as runner-up and margin < 0.2
 *   background  everything else
 */
import { NONE } from "../data/catalog.ts";
import type { Item } from "../data/splits.ts";
import type { RunRecord } from "../run/runner.ts";

export type PairState = "error" | "near" | "background";

export interface WorstItem {
  id: string;
  gold: string;
  other: string;
  leak: number;
}

export interface PairLeak {
  key: string;
  a: string;
  b: string;
  mass: number;
  /** Σ p(b) over items with gold a. */
  ab: number;
  /** Σ p(a) over items with gold b. */
  ba: number;
  /** Items with gold in {a, b} that leak at least `eps` to the other. */
  n: number;
  errors: number;
  nearMiss: number;
  worst: WorstItem | null;
  state: PairState;
  /** True when one side is none_of_these (drawn as a spoke to the hub). */
  hub: boolean;
}

export interface LeakageReport {
  pairs: PairLeak[];
  /** Σ (1 − p(gold)) over non-error items. */
  total: number;
  /** Leaked mass touching each option (both directions). */
  byOption: Map<string, number>;
}

export const NEAR_MISS_MARGIN = 0.2;

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function computeLeakage(items: Item[], run: RunRecord, eps = 1e-3): LeakageReport {
  const options = run.options;
  const k = options.length;
  const index = new Map(options.map((o, i) => [o, i]));
  const byId = new Map(run.results.map((r) => [r.id, r]));
  const acc = new Map<number, { ab: number; ba: number; n: number; errors: number; near: number; worst: WorstItem | null }>();
  const get = (i: number, j: number) => {
    const lo = Math.min(i, j);
    const hi = Math.max(i, j);
    const key = lo * k + hi;
    let e = acc.get(key);
    if (!e) {
      e = { ab: 0, ba: 0, n: 0, errors: 0, near: 0, worst: null };
      acc.set(key, e);
    }
    return { e, forward: i === lo };
  };
  let total = 0;
  for (const it of items) {
    const r = byId.get(it.id);
    const g = index.get(it.gold);
    if (!r || !r.probs || r.error || g === undefined) continue;
    const probs = r.probs;
    total += 1 - probs[g]!;
    let top = 0;
    let second = -1;
    for (let i = 1; i < k; i++) {
      if (probs[i]! > probs[top]!) {
        second = top;
        top = i;
      } else if (second < 0 || probs[i]! > probs[second]!) second = i;
    }
    if (second < 0 && k > 1) second = top === 0 ? 1 : 0;
    for (let o = 0; o < k; o++) {
      if (o === g) continue;
      const p = probs[o]!;
      if (p < eps) continue;
      const { e, forward } = get(g, o);
      if (forward) e.ab += p;
      else e.ba += p;
      e.n++;
      if (!e.worst || p > e.worst.leak) e.worst = { id: it.id, gold: it.gold, other: options[o]!, leak: p };
    }
    const chosenIndex = r.chosen ? index.get(r.chosen) : undefined;
    const chosen = chosenIndex ?? top;
    if (chosen !== g) get(g, chosen).e.errors++;
    else if (second >= 0 && top === g && probs[top]! - probs[second]! < NEAR_MISS_MARGIN) get(g, second).e.near++;
  }
  const pairs: PairLeak[] = [];
  const byOption = new Map<string, number>();
  for (const [key, e] of acc) {
    const i = Math.floor(key / k);
    const j = key % k;
    const a = options[i]!;
    const b = options[j]!;
    const mass = e.ab + e.ba;
    if (mass <= 0 && e.errors === 0 && e.near === 0) continue;
    pairs.push({
      key: pairKey(a, b),
      a,
      b,
      mass,
      ab: e.ab,
      ba: e.ba,
      n: e.n,
      errors: e.errors,
      nearMiss: e.near,
      worst: e.worst,
      state: e.errors > 0 ? "error" : e.near > 0 ? "near" : "background",
      hub: a === NONE || b === NONE,
    });
    byOption.set(a, (byOption.get(a) ?? 0) + mass);
    byOption.set(b, (byOption.get(b) ?? 0) + mass);
  }
  pairs.sort((x, y) => y.mass - x.mass || (x.key < y.key ? -1 : 1));
  return { pairs, total, byOption };
}
