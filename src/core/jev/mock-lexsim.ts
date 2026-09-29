/**
 * MOCK · lexical stand-in, not Jev.
 *
 * A deterministic BM25 scorer over the option text in the request. It exists so the whole workflow
 * (map, edit, rerun, diff, gate, seal) works with no key, and as an honest lexical baseline arm.
 * It is not an imitation of Jev and must never be described as one.
 *
 * 1. Tokenize (text.ts): CamelCase split, lowercase, stopwords, simple suffix stripping.
 * 2. One weighted document per option: option name ×2, `what` (or a plain-string criterion) ×1,
 *    `examples` ×1.5, `method` and `path` segments ×0.5.
 * 3. BM25 (k1 = 1.2, b = 0.75) between the query and each option document; IDF over the option documents.
 * 4. `not_for` penalty: subtract λ × BM25(query, not_for text).
 * 5. `none_of_these`: its BM25 score plus a constant bias β.
 * 6. Probabilities: softmax with temperature T.
 * 7. Chosen: argmax; ties go to the first option in request order.
 * 8. Confidence: (K·p_max − 1)/(K − 1), reported as "derived".
 * 9. Usage: inputTokens = ceil(request characters / 4), cost "estimated".
 *
 * λ, β and T were tuned on the dev split only (scripts/tune-mock.ts), for a readable map, not for calibration.
 */
import { UnsupportedInMock } from "./errors.ts";
import { requestCanonical } from "./request-hash.ts";
import { sha256Hex } from "./canonical.ts";
import { tokenize, splitName } from "./text.ts";
import {
  type Criterion,
  type DecideRequest,
  type DecideResult,
  type Decision,
  type DecisionBackend,
  JEV_USD_PER_INPUT_TOKEN,
  derivedChoiceConfidence,
} from "./types.ts";
import { validateRequest } from "./wire.ts";

export interface MockParams {
  k1: number;
  b: number;
  /** not_for penalty weight λ. */
  lambda: number;
  /** none_of_these bias β. */
  beta: number;
  /** softmax temperature T. */
  temperature: number;
  weights: { name: number; what: number; examples: number; methodPath: number };
}

/**
 * Tuned on dev only (scripts/tune-mock.ts, criteria.v0.json, 2026-09-29). Grid: β ∈ {2..6}, T ∈ {0.5..2}.
 * Chosen β = 5, T = 0.75: match and no-match accuracy are balanced (neither side swallows the other) and the
 * mean top probability is about 0.5, so the map shows graded leakage instead of all-or-nothing picks.
 * λ = 1 (it only acts once someone writes a `not_for`). k1 and b are the textbook BM25 defaults.
 */
export const DEFAULT_MOCK_PARAMS: MockParams = {
  k1: 1.2,
  b: 0.75,
  lambda: 1.0,
  beta: 5.0,
  temperature: 0.75,
  weights: { name: 2, what: 1, examples: 1.5, methodPath: 0.5 },
};

export const NONE_OPTION = "none_of_these";
export const MOCK_MODEL = "mock-lexsim-1";

type TermFreq = Map<string, number>;

interface OptionDoc {
  tf: TermFreq;
  len: number;
  notFor: TermFreq;
  notForLen: number;
}

export interface LexIndex {
  options: string[];
  docs: OptionDoc[];
  idf: Map<string, number>;
  avgLen: number;
  noneIndex: number;
}

function addText(tf: TermFreq, text: string, w: number): number {
  let added = 0;
  for (const t of tokenize(text)) {
    tf.set(t, (tf.get(t) ?? 0) + w);
    added += w;
  }
  return added;
}

function asText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(asText).join(" \n ");
  if (typeof v === "object") return Object.values(v as Record<string, unknown>).map(asText).join(" \n ");
  return String(v);
}

/** The option fields the mock reads from a criterion. Exported for the "Why (lexical stand-in)" view. */
export function criterionFields(c: Criterion): { what: string; notFor: string; examples: string; methodPath: string } {
  if (c === null) return { what: "", notFor: "", examples: "", methodPath: "" };
  if (typeof c === "string") return { what: c, notFor: "", examples: "", methodPath: "" };
  if (Array.isArray(c)) return { what: asText(c), notFor: "", examples: "", methodPath: "" };
  const o = c as Record<string, unknown>;
  const known = new Set(["what", "not_for", "examples", "method", "path"]);
  const rest = Object.entries(o)
    .filter(([k]) => !known.has(k))
    .map(([, v]) => asText(v))
    .join(" ");
  return {
    what: [asText(o.what), rest].filter(Boolean).join(" "),
    notFor: asText(o.not_for),
    examples: asText(o.examples),
    methodPath: [asText(o.method), asText(o.path).replace(/[{}]/g, " ")].join(" "),
  };
}

export function buildIndex(criteria: Record<string, Criterion>, p: MockParams = DEFAULT_MOCK_PARAMS): LexIndex {
  const options = Object.keys(criteria);
  const docs: OptionDoc[] = options.map((name) => {
    const f = criterionFields(criteria[name]!);
    const tf: TermFreq = new Map();
    let len = 0;
    len += addText(tf, splitName(name).replace(/_/g, " "), p.weights.name);
    len += addText(tf, f.what, p.weights.what);
    len += addText(tf, f.examples, p.weights.examples);
    len += addText(tf, f.methodPath, p.weights.methodPath);
    const notFor: TermFreq = new Map();
    const notForLen = addText(notFor, f.notFor, 1);
    return { tf, len, notFor, notForLen };
  });
  const df = new Map<string, number>();
  for (const d of docs) for (const t of d.tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const n = docs.length;
  const idf = new Map<string, number>();
  for (const [t, c] of df) idf.set(t, Math.log(1 + (n - c + 0.5) / (c + 0.5)));
  const avgLen = docs.reduce((a, d) => a + d.len, 0) / Math.max(1, n);
  return { options, docs, idf, avgLen, noneIndex: options.indexOf(NONE_OPTION) };
}

function bm25(qTerms: string[], tf: TermFreq, len: number, ix: LexIndex, p: MockParams): number {
  if (len === 0) return 0;
  const norm = p.k1 * (1 - p.b + (p.b * len) / ix.avgLen);
  let s = 0;
  for (const t of qTerms) {
    const f = tf.get(t);
    if (!f) continue;
    // Terms that appear in no option document (only in a not_for text) get the maximum IDF.
    const idf = ix.idf.get(t) ?? Math.log(1 + (ix.docs.length + 0.5) / 0.5);
    s += (idf * f * (p.k1 + 1)) / (f + norm);
  }
  return s;
}

export interface ScoreBreakdown {
  scores: number[];
  probs: number[];
}

export function scoreQuery(query: string, ix: LexIndex, p: MockParams = DEFAULT_MOCK_PARAMS): ScoreBreakdown {
  const qTerms = [...new Set(tokenize(query))];
  const scores = ix.docs.map((d, i) => {
    let s = bm25(qTerms, d.tf, d.len, ix, p);
    if (d.notForLen > 0) s -= p.lambda * bm25(qTerms, d.notFor, d.notForLen, ix, p);
    if (i === ix.noneIndex) s += p.beta;
    return s;
  });
  const max = Math.max(...scores);
  const exps = scores.map((s) => Math.exp((s - max) / p.temperature));
  const z = exps.reduce((a, b) => a + b, 0);
  return { scores, probs: exps.map((e) => e / z) };
}

/** Text of the request state the mock scores against. */
export function stateText(state: DecideRequest["state"]): string {
  if (typeof state === "string") return state;
  if (!Array.isArray(state) && typeof state === "object" && typeof (state as { request?: unknown }).request === "string")
    return (state as { request: string }).request;
  return asText(state);
}

export function createMockBackend(params: MockParams = DEFAULT_MOCK_PARAMS, now: () => number = () => performance.now()): DecisionBackend {
  const cache = new WeakMap<object, LexIndex>();
  const indexFor = (criteria: Record<string, Criterion>) => {
    let ix = cache.get(criteria);
    if (!ix) {
      ix = buildIndex(criteria, params);
      cache.set(criteria, ix);
    }
    return ix;
  };
  return {
    kind: "mock",
    label: "MOCK · lexical stand-in, not Jev",
    async decide(req: DecideRequest): Promise<DecideResult> {
      const t0 = now();
      validateRequest(req);
      const query = stateText(req.state);
      const decisions: Record<string, Decision> = {};
      for (const [id, q] of Object.entries(req.questions)) {
        if (q.type !== "choice") throw new UnsupportedInMock(q.type);
        const ix = indexFor(q.criteria);
        const { probs } = scoreQuery(query, ix, params);
        let best = 0;
        for (let i = 1; i < probs.length; i++) if (probs[i]! > probs[best]!) best = i;
        decisions[id] = {
          kind: "choice",
          options: ix.options,
          probs,
          chosen: ix.options[best]!,
          confidence: derivedChoiceConfidence(probs),
          confidenceSource: "derived",
        };
      }
      const canonical = requestCanonical(req);
      const inputTokens = Math.ceil(canonical.length / 4);
      return {
        decisions,
        model: req.model || MOCK_MODEL,
        usage: { inputTokens, outputTokens: null, costUsd: inputTokens * JEV_USD_PER_INPUT_TOKEN, costSource: "estimated" },
        meta: {
          backend: "mock",
          requestHash: await sha256Hex(canonical),
          wallMs: now() - t0,
          cached: false,
          retries: 0,
          warnings: [],
        },
      };
    },
  };
}
