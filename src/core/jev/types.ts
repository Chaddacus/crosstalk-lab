/**
 * Domain types for one `/v1/systemone` decision client. Pure TypeScript.
 * Only `wire.ts` knows the JSON field names of the HTTP API.
 */
export type Criterion = string | Record<string, unknown> | unknown[] | null;
export type Instructions = string | Record<string, unknown> | unknown[];

export type Question =
  | { type: "choice"; instructions: Instructions; criteria: Record<string, Criterion> }
  | { type: "noul"; instructions: Instructions; criteria?: { true: Criterion; false: Criterion } }
  | { type: "score"; instructions: Instructions; criteria: Criterion[] };

export interface DecideRequest {
  /** Always set. Never defaulted silently. */
  model: string;
  state: string | Record<string, unknown> | unknown[];
  questions: Record<string, Question>;
}

export type ConfidenceSource = "reported" | "derived" | "none";

export type Decision =
  | {
      kind: "choice";
      /** Options in request order. */
      options: string[];
      /** Aligned to `options`. */
      probs: number[];
      chosen: string;
      confidence: number | null;
      confidenceSource: ConfidenceSource;
    }
  | { kind: "noul"; p: number }
  | {
      kind: "score";
      levels: string[];
      probs: number[];
      score: number;
      confidence: number | null;
      confidenceSource: ConfidenceSource;
    };

export type BackendKind = "mock" | "replay" | "http";

export interface DecideResult {
  decisions: Record<string, Decision>;
  /** As reported by the server. */
  model: string;
  usage: {
    inputTokens: number;
    outputTokens: number | null;
    costUsd: number | null;
    costSource: "reported" | "list-price" | "estimated";
  };
  meta: {
    backend: BackendKind;
    requestHash: string;
    wallMs: number;
    cached: boolean;
    retries: number;
    provider?: string;
    id?: string;
    /** Non-fatal wire problems, for example probabilities that do not sum to 1. */
    warnings: string[];
  };
}

export interface DecideOptions {
  signal?: AbortSignal;
}

export interface DecisionBackend {
  readonly kind: BackendKind;
  /** For example "MOCK · lexical stand-in, not Jev" or "jev-1.13.0 · live". */
  readonly label: string;
  decide(req: DecideRequest, opts?: DecideOptions): Promise<DecideResult>;
}

/** List price, USD per input token [C: models.md, $0.042 per Mtok; output tokens are free]. */
export const JEV_USD_PER_INPUT_TOKEN = 0.042 / 1_000_000;
export const MAX_CHOICE_OPTIONS = 255;
export const MIN_SCORE_LEVELS = 2;
export const MAX_SCORE_LEVELS = 10;

/**
 * Choice confidence derived from probabilities: (K·p_max − 1)/(K − 1), clamped to [0, 1].
 * Inferred to match TypeSafe's published examples; TypeSafe does not document the formula.
 */
export function derivedChoiceConfidence(probs: number[]): number {
  const k = probs.length;
  if (k < 2) return 1;
  const pmax = Math.max(...probs);
  return Math.min(1, Math.max(0, (k * pmax - 1) / (k - 1)));
}
