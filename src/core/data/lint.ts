/**
 * Data lint: gold labels, ids, split overlap, no-match share, privacy patterns, spec-echo rate.
 * Pure TypeScript. Runs in `npm test` and `npm run lint:data`.
 */
import type { Operation } from "./catalog.ts";
import { NONE } from "./catalog.ts";
import { type Item, normalizeQuery } from "./splits.ts";
import { splitName, tokenize } from "../jev/text.ts";

export interface LintReport {
  errors: string[];
  warnings: string[];
  stats: {
    items: number;
    noMatchShare: number;
    distinctOps: number;
    specEchoRate: number;
    specEchoItems: string[];
  };
}

/** Digit runs that look like phone numbers. Allowed: numbers whose last seven digits are 555-01xx. */
const PHONE = /(?<![A-Za-z0-9])\+?\d[\d\s().-]{6,}\d(?![A-Za-z0-9])/g;
const EMAIL = /[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})/gi;
/** Real-looking Twilio SIDs: two capital letters and 32 hex characters. */
const REAL_SID = /\b[A-Z]{2}[0-9a-f]{32}\b/;
const IPV4 = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g;
const DOC_NETS = ["192.0.2.", "198.51.100.", "203.0.113."];

export function privacyProblems(query: string): string[] {
  const out: string[] = [];
  for (const m of query.matchAll(PHONE)) {
    const digits = m[0].replace(/\D/g, "");
    if (digits.length < 7) continue;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(m[0].trim())) continue; // an IPv4 address, checked below
    if (!/55501\d\d$/.test(digits)) out.push(`phone number outside 555-01xx: "${m[0]}"`);
  }
  for (const m of query.matchAll(EMAIL)) {
    const domain = m[1]!.toLowerCase();
    if (domain !== "example.com" && !domain.endsWith(".example.com")) out.push(`email outside example.com: "${m[0]}"`);
  }
  if (REAL_SID.test(query)) out.push("real-looking SID (2 letters + 32 hex)");
  for (const m of query.matchAll(IPV4)) {
    if (!DOC_NETS.some((n) => m[0].startsWith(n))) out.push(`IP outside documentation ranges: ${m[0]}`);
  }
  return out;
}

/** A match query "echoes" the spec when it contains every token of its gold operation name. */
export function isSpecEcho(item: Pick<Item, "gold" | "query">): boolean {
  if (item.gold === NONE) return false;
  const q = new Set(tokenize(item.query));
  const nameTokens = tokenize(splitName(item.gold));
  return nameTokens.length > 0 && nameTokens.every((t) => q.has(t));
}

export function lintSplit(
  ops: Operation[],
  items: Item[],
  opts: { minNoMatch?: number; maxNoMatch?: number; minDistinctOps?: number } = {},
): LintReport {
  const { minNoMatch = 0.25, maxNoMatch = 0.35, minDistinctOps = 100 } = opts;
  const byId = new Map(ops.map((o) => [o.id, o]));
  const errors: string[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  const seenQ = new Map<string, string>();
  for (const it of items) {
    if (seen.has(it.id)) errors.push(`${it.id}: duplicate id`);
    seen.add(it.id);
    if (it.gold !== NONE && !byId.has(it.gold)) errors.push(`${it.id}: gold ${it.gold} is not in the catalog`);
    if ((it.gold === NONE) !== (it.kind === "no_match")) errors.push(`${it.id}: kind ${it.kind} does not match gold ${it.gold}`);
    const fam = byId.get(it.gold)?.family ?? "none";
    if (it.family !== fam) errors.push(`${it.id}: family ${it.family} should be ${fam}`);
    const n = normalizeQuery(it.query);
    if (seenQ.has(n)) errors.push(`${it.id}: same query as ${seenQ.get(n)}`);
    seenQ.set(n, it.id);
    for (const p of privacyProblems(it.query)) errors.push(`${it.id}: ${p}`);
  }
  const noMatch = items.filter((i) => i.gold === NONE).length;
  const share = items.length ? noMatch / items.length : 0;
  if (share < minNoMatch || share > maxNoMatch)
    errors.push(`no-match share ${(share * 100).toFixed(1)}% is outside ${minNoMatch * 100}-${maxNoMatch * 100}%`);
  const distinct = new Set(items.filter((i) => i.gold !== NONE).map((i) => i.gold)).size;
  if (distinct < minDistinctOps) warnings.push(`only ${distinct} distinct operations (target >= ${minDistinctOps})`);
  const match = items.filter((i) => i.gold !== NONE);
  const echo = match.filter(isSpecEcho);
  return {
    errors,
    warnings,
    stats: {
      items: items.length,
      noMatchShare: share,
      distinctOps: distinct,
      specEchoRate: match.length ? echo.length / match.length : 0,
      specEchoItems: echo.map((i) => i.id),
    },
  };
}

/** Errors for queries that appear in both splits (exact or normalized). */
export function crossSplitOverlap(a: Item[], b: Item[]): string[] {
  const m = new Map(a.map((i) => [normalizeQuery(i.query), i.id]));
  return b.filter((i) => m.has(normalizeQuery(i.query))).map((i) => `${i.id} repeats ${m.get(normalizeQuery(i.query))}`);
}
