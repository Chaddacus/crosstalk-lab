/**
 * Request hash: sha256 of the canonical JSON of { model, state, questions } (the wire body).
 * Same value as `hashJson({model, state, questions})`, but caches the canonical text of each Choice
 * question by its criteria object, so hashing 180 requests that share 198 criteria stays cheap.
 */
import { canonicalJson, sha256Hex } from "./canonical.ts";
import type { DecideRequest, Question } from "./types.ts";

const questionCache = new WeakMap<object, Map<string, string>>();

function canonicalQuestion(q: Question): string {
  const key = (q.criteria ?? null) as object | null;
  if (!key || typeof key !== "object") return canonicalJson(q);
  let byRest = questionCache.get(key);
  if (!byRest) {
    byRest = new Map();
    questionCache.set(key, byRest);
  }
  const restKey = q.type + "\u0000" + canonicalJson(q.instructions);
  let s = byRest.get(restKey);
  if (s === undefined) {
    s = canonicalJson(q);
    byRest.set(restKey, s);
  }
  return s;
}

export function requestCanonical(req: DecideRequest): string {
  const ids = Object.keys(req.questions).sort();
  const qs = "{" + ids.map((id) => JSON.stringify(id) + ":" + canonicalQuestion(req.questions[id]!)).join(",") + "}";
  return '{"model":' + JSON.stringify(req.model) + ',"questions":' + qs + ',"state":' + canonicalJson(req.state) + "}";
}

export function requestHash(req: DecideRequest): Promise<string> {
  return sha256Hex(requestCanonical(req));
}
