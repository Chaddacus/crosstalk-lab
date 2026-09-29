/**
 * Criteria versions: the editable wording of each option, and the mapping to a Choice `criteria` map.
 * Field order on the wire is fixed: method, path, what, not_for, examples. Empty fields are left out.
 * `method` and `path` come from the catalog and are not editable.
 */
import type { Criterion } from "../jev/types.ts";
import { hashJson } from "../jev/canonical.ts";
import { NONE, type Operation } from "./catalog.ts";

export interface OptionText {
  what?: string;
  not_for?: string;
  examples?: string[];
}

export type CriteriaTexts = Record<string, OptionText>;

export const DEFAULT_NONE_TEXT =
  "Not a request for any operation in this API: how-to questions, other products, other vendors, small talk.";

export const INSTRUCTIONS =
  "Which operation in the Twilio REST API (2010-04-01) should an agent call first to fulfil `request`? " +
  "If no operation in this API fulfils it, choose none_of_these.";

function clean(t: OptionText | undefined): OptionText {
  const out: OptionText = {};
  const what = t?.what?.trim();
  const notFor = t?.not_for?.trim();
  const ex = (t?.examples ?? []).map((e) => e.trim()).filter(Boolean);
  if (what) out.what = what;
  if (notFor) out.not_for = notFor;
  if (ex.length) out.examples = ex;
  return out;
}

/** v0: derived from the spec only. `what` is the spec description; operations with no description get none. */
export function textsFromSpec(ops: Operation[]): CriteriaTexts {
  const texts: CriteriaTexts = {};
  for (const o of ops) texts[o.id] = o.description ? { what: o.description } : {};
  texts[NONE] = { what: DEFAULT_NONE_TEXT };
  return texts;
}

/** Build the Choice criteria map in catalog order, then none_of_these last. */
export function toChoiceCriteria(ops: Operation[], texts: CriteriaTexts): Record<string, Criterion> {
  const out: Record<string, Criterion> = {};
  for (const o of ops) {
    const t = clean(texts[o.id]);
    const c: Record<string, unknown> = { method: o.method, path: o.shortPath };
    if (t.what) c.what = t.what;
    if (t.not_for) c.not_for = t.not_for;
    if (t.examples) c.examples = t.examples;
    out[o.id] = c;
  }
  const n = clean(texts[NONE] ?? { what: DEFAULT_NONE_TEXT });
  out[NONE] = !n.not_for && !n.examples ? (n.what ?? null) : { ...n };
  return out;
}

/** Parse a Choice criteria map (for example criteria.v0.json) back into editable texts. */
export function textsFromChoiceCriteria(criteria: Record<string, Criterion>): CriteriaTexts {
  const texts: CriteriaTexts = {};
  for (const [id, c] of Object.entries(criteria)) {
    if (c === null) texts[id] = {};
    else if (typeof c === "string") texts[id] = { what: c };
    else if (Array.isArray(c)) texts[id] = { what: JSON.stringify(c) };
    else {
      const o = c as Record<string, unknown>;
      texts[id] = clean({
        what: typeof o.what === "string" ? o.what : undefined,
        not_for: typeof o.not_for === "string" ? o.not_for : undefined,
        examples: Array.isArray(o.examples) ? o.examples.map(String) : undefined,
      });
    }
  }
  return texts;
}

export function criteriaHash(criteria: Record<string, Criterion>): Promise<string> {
  return hashJson(criteria);
}

export function textsEqual(a: OptionText | undefined, b: OptionText | undefined): boolean {
  const x = clean(a);
  const y = clean(b);
  return x.what === y.what && x.not_for === y.not_for && JSON.stringify(x.examples ?? []) === JSON.stringify(y.examples ?? []);
}

/** Options whose text differs between two versions. */
export function changedOptions(a: CriteriaTexts, b: CriteriaTexts): string[] {
  const ids = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...ids].filter((id) => !textsEqual(a[id], b[id]));
}
