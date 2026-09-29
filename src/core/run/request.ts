/** One request per item: one Choice over the operations plus none_of_these. */
import { INSTRUCTIONS } from "../data/criteria.ts";
import type { Criterion, DecideRequest } from "../jev/types.ts";

export const QUESTION_ID = "operation";

export function buildRequest(criteria: Record<string, Criterion>, query: string, model: string): DecideRequest {
  return {
    model,
    state: { request: query },
    questions: { [QUESTION_ID]: { type: "choice", instructions: INSTRUCTIONS, criteria } },
  };
}
