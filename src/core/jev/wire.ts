/**
 * Wire mapping for `POST /v1/systemone`. The only file that knows the JSON field names.
 *
 * Status of each fact (see SPEC §5.2):
 *  [C]    confirmed in TypeSafe docs (api.md): body {state, model, questions}; model required; Choice up to 255 options;
 *         Score criteria ordered array (2..10); response {model, answers, usage{input_tokens, output_tokens}};
 *         Choice answer {type, choice, probabilities, confidence}; Score answer {score, legend, probabilities
 *         (0-indexed string keys), confidence}; Noul answer {type, noul} with no confidence.
 *  [C-OR] OpenRouter adds optional `id`, `provider`, `usage.cost`, and marks probabilities/confidence optional.
 *  [G]    guessed: tie-breaking, 422 body shape. Code does not depend on them.
 */
import { z } from "zod";
import { RequestError, SchemaError } from "./errors.ts";
import {
  type Decision,
  type DecideRequest,
  type DecideResult,
  JEV_USD_PER_INPUT_TOKEN,
  MAX_CHOICE_OPTIONS,
  MAX_SCORE_LEVELS,
  MIN_SCORE_LEVELS,
  derivedChoiceConfidence,
} from "./types.ts";

// ---------- request ----------

const Json: z.ZodType<unknown> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(Json), z.record(z.string(), Json)]),
);
const Content = z.union([z.string(), z.record(z.string(), Json), z.array(Json)]);
const CriterionSchema = z.union([z.string(), z.record(z.string(), Json), z.array(Json), z.null()]);

export const WireQuestionSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("choice"),
    instructions: Content,
    criteria: z.record(z.string(), CriterionSchema),
  }),
  z.strictObject({
    type: z.literal("noul"),
    instructions: Content,
    criteria: z.strictObject({ true: CriterionSchema, false: CriterionSchema }).optional(),
  }),
  z.strictObject({
    type: z.literal("score"),
    instructions: Content,
    criteria: z.array(CriterionSchema),
  }),
]);

export const WireRequestSchema = z.strictObject({
  state: Content,
  model: z.string().min(1),
  questions: z.record(z.string(), WireQuestionSchema),
});
export type WireRequest = z.infer<typeof WireRequestSchema>;

/** Check the rules the API documents, before sending. Throws RequestError. */
export function validateRequest(req: DecideRequest): void {
  if (!req.model || typeof req.model !== "string") throw new RequestError("model is required and must be a non-empty string");
  const qs = Object.entries(req.questions ?? {});
  if (qs.length === 0) throw new RequestError("at least one question is required");
  for (const [id, q] of qs) {
    if (q.type === "choice") {
      const n = Object.keys(q.criteria ?? {}).length;
      if (n < 1) throw new RequestError(`question ${id}: a Choice needs at least one option`);
      if (n > MAX_CHOICE_OPTIONS) throw new RequestError(`question ${id}: ${n} options exceed the ${MAX_CHOICE_OPTIONS}-option Choice limit`);
    } else if (q.type === "score") {
      const n = q.criteria?.length ?? 0;
      if (n < MIN_SCORE_LEVELS || n > MAX_SCORE_LEVELS)
        throw new RequestError(`question ${id}: a Score needs ${MIN_SCORE_LEVELS}..${MAX_SCORE_LEVELS} levels, got ${n}`);
    } else if (q.type === "noul") {
      const c = q.criteria as Record<string, unknown> | undefined;
      if (c !== undefined && (!("true" in c) || !("false" in c)))
        throw new RequestError(`question ${id}: Noul criteria must have both true and false, or be omitted`);
    } else {
      throw new RequestError(`question ${id}: unknown type ${(q as { type: string }).type}`);
    }
  }
}

/** Domain request -> JSON body. Always sends `model`. */
export function toWire(req: DecideRequest): WireRequest {
  validateRequest(req);
  const questions: WireRequest["questions"] = {};
  for (const [id, q] of Object.entries(req.questions)) {
    if (q.type === "noul") {
      questions[id] = q.criteria
        ? { type: "noul", instructions: q.instructions, criteria: { true: q.criteria.true, false: q.criteria.false } }
        : { type: "noul", instructions: q.instructions };
    } else {
      questions[id] = { ...q } as WireRequest["questions"][string];
    }
  }
  const body = { state: req.state, model: req.model, questions };
  const parsed = WireRequestSchema.safeParse(body);
  if (!parsed.success) throw new RequestError(`request does not match the wire schema: ${parsed.error.message}`);
  return parsed.data;
}

// ---------- response ----------

const ProbMap = z.record(z.string(), z.number());

const ChoiceAnswer = z.looseObject({
  type: z.literal("choice"),
  choice: z.string(),
  probabilities: ProbMap.optional(),
  confidence: z.number().optional(),
});
const ScoreAnswer = z.looseObject({
  type: z.literal("score"),
  score: z.number(),
  legend: z.record(z.string(), Json).optional(),
  probabilities: ProbMap.optional(),
  confidence: z.number().optional(),
});
const NoulAnswer = z.looseObject({ type: z.literal("noul"), noul: z.number() });

export const WireResponseSchema = z.looseObject({
  model: z.string(),
  answers: z.record(z.string(), z.looseObject({ type: z.string() })),
  usage: z.looseObject({
    input_tokens: z.number().optional(),
    output_tokens: z.number().optional(),
    cost: z.number().optional(),
  }),
  id: z.string().optional(),
  provider: z.string().optional(),
});
export type WireResponse = z.infer<typeof WireResponseSchema>;

export interface FromWireMeta {
  backend: DecideResult["meta"]["backend"];
  requestHash: string;
  wallMs: number;
  cached: boolean;
  retries: number;
}

/** JSON body -> domain result. Throws SchemaError when the body does not match what was asked. */
export function fromWire(json: unknown, req: DecideRequest, meta: FromWireMeta): DecideResult {
  const top = WireResponseSchema.safeParse(json);
  if (!top.success) throw new SchemaError(`response does not match the wire format: ${top.error.issues[0]?.message ?? "invalid"}`);
  const res = top.data;
  const warnings: string[] = [];
  const decisions: Record<string, Decision> = {};
  for (const [id, q] of Object.entries(req.questions)) {
    const raw = res.answers[id];
    if (!raw) throw new SchemaError(`no answer for question ${id}`);
    if (raw.type !== q.type) {
      if (!["choice", "noul", "score"].includes(raw.type)) throw new SchemaError(`unknown answer type ${raw.type} for question ${id}`);
      throw new SchemaError(`answer for ${id} has type ${raw.type}, expected ${q.type}`);
    }
    if (q.type === "choice") {
      const a = ChoiceAnswer.safeParse(raw);
      if (!a.success) throw new SchemaError(`choice answer ${id}: ${a.error.issues[0]?.message}`);
      if (!a.data.probabilities) throw new SchemaError(`choice answer ${id} has no probabilities`);
      const options = Object.keys(q.criteria);
      const probsMap = a.data.probabilities;
      const got = Object.keys(probsMap);
      const missing = options.filter((o) => !(o in probsMap));
      const extra = got.filter((o) => !(o in q.criteria));
      if (missing.length || extra.length)
        throw new SchemaError(
          `choice answer ${id}: option set mismatch (missing ${missing.slice(0, 3).join(", ") || "none"}; extra ${extra.slice(0, 3).join(", ") || "none"})`,
        );
      const probs = options.map((o) => probsMap[o]!);
      checkDistribution(probs, `choice ${id}`, warnings);
      if (!options.includes(a.data.choice)) throw new SchemaError(`choice answer ${id}: chosen option ${a.data.choice} was not offered`);
      const maxP = Math.max(...probs);
      if (probsMap[a.data.choice]! < maxP - 1e-12) warnings.push(`choice ${id}: chosen option is not the argmax`);
      decisions[id] = {
        kind: "choice",
        options,
        probs,
        chosen: a.data.choice,
        confidence: a.data.confidence ?? derivedChoiceConfidence(probs),
        confidenceSource: a.data.confidence === undefined ? "derived" : "reported",
      };
    } else if (q.type === "score") {
      const a = ScoreAnswer.safeParse(raw);
      if (!a.success) throw new SchemaError(`score answer ${id}: ${a.error.issues[0]?.message}`);
      const n = q.criteria.length;
      const levels: string[] = [];
      const probs: number[] = [];
      for (let i = 0; i < n; i++) {
        const legend = a.data.legend?.[String(i)];
        levels.push(typeof legend === "string" ? legend : JSON.stringify(legend ?? q.criteria[i]));
        const p = a.data.probabilities?.[String(i)];
        if (a.data.probabilities && p === undefined) throw new SchemaError(`score answer ${id}: no probability for level ${i}`);
        probs.push(p ?? NaN);
      }
      if (a.data.probabilities) checkDistribution(probs, `score ${id}`, warnings);
      decisions[id] = {
        kind: "score",
        levels,
        probs,
        score: a.data.score,
        confidence: a.data.confidence ?? null,
        confidenceSource: a.data.confidence === undefined ? "none" : "reported",
      };
    } else {
      const a = NoulAnswer.safeParse(raw);
      if (!a.success) throw new SchemaError(`noul answer ${id}: ${a.error.issues[0]?.message}`);
      decisions[id] = { kind: "noul", p: a.data.noul };
    }
  }
  const inputTokens = res.usage.input_tokens ?? 0;
  if (res.usage.input_tokens === undefined) warnings.push("usage.input_tokens missing");
  const reported = res.usage.cost;
  return {
    decisions,
    model: res.model,
    usage: {
      inputTokens,
      outputTokens: res.usage.output_tokens ?? null,
      costUsd: reported ?? inputTokens * JEV_USD_PER_INPUT_TOKEN,
      costSource: reported !== undefined ? "reported" : "list-price",
    },
    meta: { ...meta, provider: res.provider, id: res.id, warnings },
  };
}

function checkDistribution(probs: number[], label: string, warnings: string[]) {
  if (probs.some((p) => !Number.isFinite(p) || p < 0 || p > 1)) throw new SchemaError(`${label}: probabilities must be numbers in [0, 1]`);
  const sum = probs.reduce((a, b) => a + b, 0);
  if (sum < 0.99 || sum > 1.01) warnings.push(`${label}: probabilities sum to ${sum.toFixed(4)}`);
}

/** Domain-side view of a wire response, for fixtures and replay: build the wire JSON from a Choice decision. */
export function choiceToWire(
  model: string,
  questionId: string,
  d: Extract<Decision, { kind: "choice" }>,
  inputTokens: number,
): WireResponse {
  const probabilities: Record<string, number> = {};
  d.options.forEach((o, i) => (probabilities[o] = d.probs[i]!));
  return {
    model,
    answers: {
      [questionId]: { type: "choice", choice: d.chosen, probabilities, ...(d.confidence === null ? {} : { confidence: d.confidence }) },
    },
    usage: { input_tokens: inputTokens, output_tokens: 0 },
  };
}
