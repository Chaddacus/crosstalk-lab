/**
 * Replay backend: returns cached wire responses by request hash.
 * A cache miss is an error on that item. It never falls back to another backend.
 *
 * Public fixtures (fixtures/replay/) are generated from the mock only (scripts/demo-fixtures.ts).
 * Real Jev responses are cached only in .cache/ (gitignored) by the local server and stay on the
 * machine that made them.
 */
import { ReplayMiss } from "./errors.ts";
import { requestHash } from "./request-hash.ts";
import type { DecideRequest, DecideResult, DecisionBackend } from "./types.ts";
import { fromWire, validateRequest } from "./wire.ts";

export interface ReplayStore {
  get(hash: string): Promise<unknown | undefined> | unknown | undefined;
}

export function createReplayBackend(store: ReplayStore, label = "REPLAY · cached responses"): DecisionBackend {
  return {
    kind: "replay",
    label,
    async decide(req: DecideRequest): Promise<DecideResult> {
      const t0 = performance.now();
      validateRequest(req);
      const hash = await requestHash(req);
      const json = await store.get(hash);
      if (json === undefined) throw new ReplayMiss(hash);
      return fromWire(json, req, { backend: "replay", requestHash: hash, wallMs: performance.now() - t0, cached: true, retries: 0 });
    },
  };
}

/**
 * Compact fixture file: one per (criteria hash, split). Options are stored once; each response keeps the
 * probabilities as an array aligned to `options`, rounded to 5 decimals. `toWire` rebuilds the wire JSON.
 */
export interface ReplayFixture {
  kind: "crosstalk-replay-fixture";
  generatedBy: string;
  note: string;
  model: string;
  criteriaHash: string;
  criteriaVersion: string;
  split: string;
  questionId: string;
  options: string[];
  responses: Record<string, { choice: string; p: number[]; confidence: number; input_tokens: number }>;
}

export function fixtureResponseToWire(f: ReplayFixture, hash: string): unknown | undefined {
  const r = f.responses[hash];
  if (!r) return undefined;
  const probabilities: Record<string, number> = {};
  f.options.forEach((o, i) => (probabilities[o] = r.p[i] ?? 0));
  return {
    model: f.model,
    answers: { [f.questionId]: { type: "choice", choice: r.choice, probabilities, confidence: r.confidence } },
    usage: { input_tokens: r.input_tokens, output_tokens: 0 },
  };
}

export function fixtureStore(fixtures: ReplayFixture[], extra?: Map<string, unknown>): ReplayStore {
  const byHash = new Map<string, ReplayFixture>();
  for (const f of fixtures) for (const h of Object.keys(f.responses)) byHash.set(h, f);
  return {
    get: (h) => {
      if (extra?.has(h)) return extra.get(h);
      const f = byHash.get(h);
      return f ? fixtureResponseToWire(f, h) : undefined;
    },
  };
}
