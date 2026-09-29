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
      const res = fromWire(json, req, { backend: "replay", requestHash: hash, wallMs: performance.now() - t0, cached: true, retries: 0 });
      return applyProvenance(res, (json as { [PROVENANCE_KEY]?: ReplayProvenance })[PROVENANCE_KEY]);
    },
  };
}

/**
 * Where a replayed value came from. Mock fixtures store the mock's derived confidence and its characters ÷ 4
 * token estimate in ordinary wire fields; this keeps their labels honest ("derived", "estimated") on replay.
 */
export interface ReplayProvenance {
  confidence?: "derived";
  inputTokens?: "estimated";
}

/** Private key on a replayed wire JSON (ignored by the wire schema, read by the replay backend). */
export const PROVENANCE_KEY = "x_crosstalk_provenance";

function applyProvenance(res: DecideResult, p: ReplayProvenance | undefined): DecideResult {
  if (!p) return res;
  const decisions = { ...res.decisions };
  if (p.confidence === "derived")
    for (const [id, d] of Object.entries(decisions)) if (d.kind === "choice" && d.confidence !== null) decisions[id] = { ...d, confidenceSource: "derived" };
  const usage = p.inputTokens === "estimated" && res.usage.costSource !== "reported" ? { ...res.usage, costSource: "estimated" as const } : res.usage;
  return { ...res, decisions, usage };
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
  /** Absent in fixtures made from real responses (their fields are as reported). */
  provenance?: ReplayProvenance;
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
    ...(f.provenance ? { [PROVENANCE_KEY]: f.provenance } : {}),
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
