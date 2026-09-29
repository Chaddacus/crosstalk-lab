/**
 * Replay backend: returns cached wire responses by request hash.
 * A cache miss is an error on that item. It never falls back to another backend.
 *
 * Public fixtures (fixtures/replay/) are generated from the mock only. Real Jev responses are cached
 * only in .cache/ (gitignored) by the local server and stay on the machine that made them.
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

/** Fixture file format: one file per (criteria hash, split). */
export interface ReplayFixture {
  kind: "crosstalk-replay-fixture";
  generatedBy: string;
  model: string;
  criteriaHash: string;
  split: string;
  responses: Record<string, unknown>;
}

export function mapStore(...fixtures: ReplayFixture[]): ReplayStore {
  const m = new Map<string, unknown>();
  for (const f of fixtures) for (const [k, v] of Object.entries(f.responses)) m.set(k, v);
  return { get: (h) => m.get(h) };
}
