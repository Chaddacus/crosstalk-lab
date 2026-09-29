/**
 * Leaked mass between option pairs: the soft confusion matrix from one run.
 *
 * M(a, b) = Σ p(b) over items whose gold is a  +  Σ p(a) over items whose gold is b.
 * Every contribution counts toward M, however small. Unit: "items' worth of probability".
 * Pairs are unordered; `ab` and `ba` keep the directions.
 *
 * `eps` only decides two things: which items count in `n` (items that leak at least eps to the other option),
 * and which pairs are listed. A pair with M < eps and no error or near-miss is not listed; its mass is kept in
 * `omitted`, so Σ pairs[].mass + omitted.mass = total (up to float rounding).
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
  /** Leaked mass touching each option (both directions, all contributions). */
  byOption: Map<string, number>;
  /** Pairs below eps with no error or near-miss: not listed, but their mass is part of `total`. */
  omitted: { pairs: number; mass: number };
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
  // Dense upper-triangle accumulators, indexed lo * k + hi. Cheap enough to rebuild on every streamed result.
  const size = k * k;
  const ab = new Float64Array(size);
  const ba = new Float64Array(size);
  const n = new Int32Array(size);
  const errors = new Int32Array(size);
  const near = new Int32Array(size);
  const worstLeak = new Float64Array(size);
  const worstItem = new Int32Array(size).fill(-1);
  const worstOther = new Int32Array(size);
  const at = (i: number, j: number) => (i < j ? i * k + j : j * k + i);
  let total = 0;
  items.forEach((it, itemIndex) => {
    const r = byId.get(it.id);
    const g = index.get(it.gold);
    if (!r || !r.probs || r.error || g === undefined) return;
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
      if (!(p > 0)) continue;
      const key = at(g, o);
      if (g < o) ab[key] += p;
      else ba[key] += p;
      if (p >= eps) n[key]++;
      if (p > worstLeak[key]!) {
        worstLeak[key] = p;
        worstItem[key] = itemIndex;
        worstOther[key] = o;
      }
    }
    const chosenIndex = r.chosen ? index.get(r.chosen) : undefined;
    const chosen = chosenIndex ?? top;
    if (chosen !== g) errors[at(g, chosen)]++;
    else if (second >= 0 && top === g && probs[top]! - probs[second]! < NEAR_MISS_MARGIN) near[at(g, second)]++;
  });
  const pairs: PairLeak[] = [];
  const byOption = new Map<string, number>();
  const omitted = { pairs: 0, mass: 0 };
  for (let i = 0; i < k; i++) {
    for (let j = i + 1; j < k; j++) {
      const key = i * k + j;
      const mass = ab[key]! + ba[key]!;
      if (mass <= 0 && errors[key] === 0 && near[key] === 0) continue;
      const a = options[i]!;
      const b = options[j]!;
      byOption.set(a, (byOption.get(a) ?? 0) + mass);
      byOption.set(b, (byOption.get(b) ?? 0) + mass);
      if (mass < eps && errors[key] === 0 && near[key] === 0) {
        omitted.pairs++;
        omitted.mass += mass;
        continue;
      }
      const wi = worstItem[key]!;
      const w = wi >= 0 ? items[wi]! : null;
      pairs.push({
        key: pairKey(a, b),
        a,
        b,
        mass,
        ab: ab[key]!,
        ba: ba[key]!,
        n: n[key]!,
        errors: errors[key]!,
        nearMiss: near[key]!,
        worst: w ? { id: w.id, gold: w.gold, other: options[worstOther[key]!]!, leak: worstLeak[key]! } : null,
        state: errors[key]! > 0 ? "error" : near[key]! > 0 ? "near" : "background",
        hub: a === NONE || b === NONE,
      });
    }
  }
  pairs.sort((x, y) => y.mass - x.mass || (x.key < y.key ? -1 : 1));
  return { pairs, total, byOption, omitted };
}
