/**
 * Run a split through a backend. Results are stored in item order; `onResult` fires in completion order.
 * Wall time is measured from the first request to the last response. It never includes UI pacing.
 * A failed item is marked `error`; it is never counted as right, wrong or abstain.
 */
import { hashJson } from "../jev/canonical.ts";
import { CrosstalkError } from "../jev/errors.ts";
import type { BackendKind, ConfidenceSource, Criterion, DecisionBackend } from "../jev/types.ts";
import type { Item } from "../data/splits.ts";
import { QUESTION_ID, buildRequest } from "./request.ts";

export interface ItemResult {
  id: string;
  chosen: string | null;
  /** Aligned to RunRecord.options. */
  probs: number[] | null;
  confidence: number | null;
  confidenceSource: ConfidenceSource;
  inputTokens: number;
  costUsd: number | null;
  costSource: "reported" | "list-price" | "estimated" | null;
  cached: boolean;
  error?: { code: string; message: string };
}

export interface RunRecord {
  kind: "crosstalk-run";
  criteriaHash: string;
  criteriaVersion?: string;
  backend: BackendKind;
  backendLabel: string;
  model: string;
  split: "dev" | "test";
  options: string[];
  results: ItemResult[];
  startedAt: string;
  wallMs: number;
  runHash: string;
  errors: number;
  inputTokens: number;
  costUsd: number;
  costSource: "reported" | "list-price" | "estimated" | "mixed";
}

export interface RunOptions {
  backend: DecisionBackend;
  items: Item[];
  criteria: Record<string, Criterion>;
  criteriaHash: string;
  criteriaVersion?: string;
  model: string;
  split: "dev" | "test";
  concurrency?: number;
  /** Item ids in the order to run. Default: file order. Every item still runs. */
  order?: string[];
  onResult?: (r: ItemResult, done: number, total: number) => void;
  signal?: AbortSignal;
  now?: () => number;
}

/** Items with the most probability on the edited options in the last run go first. Only changes order. */
export function priorityOrder(items: Item[], prev: RunRecord | null, edited: string[]): string[] {
  if (!prev || edited.length === 0) return items.map((i) => i.id);
  const idx = edited.map((o) => prev.options.indexOf(o)).filter((i) => i >= 0);
  const byId = new Map(prev.results.map((r) => [r.id, r]));
  const weight = (id: string) => {
    const r = byId.get(id);
    if (!r?.probs) return 0;
    return idx.reduce((a, i) => a + r.probs![i]!, 0);
  };
  return items
    .map((it, i) => ({ id: it.id, w: weight(it.id), i }))
    .sort((a, b) => b.w - a.w || a.i - b.i)
    .map((x) => x.id);
}

export async function runHashOf(r: Pick<RunRecord, "criteriaHash" | "backend" | "model" | "split" | "results">): Promise<string> {
  return hashJson({
    criteriaHash: r.criteriaHash,
    backend: r.backend,
    model: r.model,
    split: r.split,
    results: r.results.map((x) => [x.id, x.chosen, x.probs, x.error?.code ?? null]),
  });
}

export async function runItems(o: RunOptions): Promise<RunRecord> {
  const now = o.now ?? (() => performance.now());
  const options = Object.keys(o.criteria);
  const byId = new Map(o.items.map((i) => [i.id, i]));
  const order = (o.order ?? o.items.map((i) => i.id)).filter((id) => byId.has(id));
  for (const it of o.items) if (!order.includes(it.id)) order.push(it.id);
  const results = new Map<string, ItemResult>();
  const concurrency = Math.max(1, o.concurrency ?? 8);
  const startedAt = new Date().toISOString();
  const t0 = now();
  let tLast = t0;
  let next = 0;
  let done = 0;
  let model = o.model;

  async function worker() {
    while (next < order.length) {
      if (o.signal?.aborted) return;
      const id = order[next++]!;
      const item = byId.get(id)!;
      let r: ItemResult;
      try {
        const res = await o.backend.decide(buildRequest(o.criteria, item.query, o.model), { signal: o.signal });
        const d = res.decisions[QUESTION_ID];
        if (!d || d.kind !== "choice") throw new CrosstalkError("schema", "missing choice decision");
        model = res.model;
        r = {
          id,
          chosen: d.chosen,
          probs: d.probs,
          confidence: d.confidence,
          confidenceSource: d.confidenceSource,
          inputTokens: res.usage.inputTokens,
          costUsd: res.usage.costUsd,
          costSource: res.usage.costSource,
          cached: res.meta.cached,
        };
      } catch (e) {
        const err = e as Error & { code?: string };
        r = {
          id,
          chosen: null,
          probs: null,
          confidence: null,
          confidenceSource: "none",
          inputTokens: 0,
          costUsd: null,
          costSource: null,
          cached: false,
          error: { code: err.code ?? "error", message: err.message ?? String(e) },
        };
      }
      tLast = now();
      results.set(id, r);
      done++;
      o.onResult?.(r, done, order.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, order.length) }, worker));
  const ordered = o.items.map((i) => results.get(i.id)).filter((x): x is ItemResult => !!x);
  const sources = new Set(ordered.filter((r) => r.costSource).map((r) => r.costSource));
  const rec: Omit<RunRecord, "runHash"> = {
    kind: "crosstalk-run",
    criteriaHash: o.criteriaHash,
    criteriaVersion: o.criteriaVersion,
    backend: o.backend.kind,
    backendLabel: o.backend.label,
    model,
    split: o.split,
    options,
    results: ordered,
    startedAt,
    wallMs: tLast - t0,
    errors: ordered.filter((r) => r.error).length,
    inputTokens: ordered.reduce((a, r) => a + r.inputTokens, 0),
    costUsd: ordered.reduce((a, r) => a + (r.costUsd ?? 0), 0),
    costSource: sources.size === 1 ? ([...sources][0] as RunRecord["costSource"]) : sources.size === 0 ? "estimated" : "mixed",
  };
  return { ...rec, runHash: await runHashOf(rec) };
}
