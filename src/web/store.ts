/**
 * One store (Zustand). Slices: criteria versions, runs, the active run, selection, UI, seal, live health.
 * The run controller at the bottom sends jobs to the Web Worker (MOCK, REPLAY) or to the local server (LIVE).
 */
import { create } from "zustand";
import { changedOptions, criteriaHash, type CriteriaTexts, type OptionText, textsFromChoiceCriteria, toChoiceCriteria } from "../core/data/criteria.ts";
import type { Criterion } from "../core/jev/types.ts";
import { priorityOrder, runHashOf, runItems, type ItemResult, type RunRecord } from "../core/run/runner.ts";
import { createHttpBackend } from "../core/jev/http.ts";
import type { LedgerRow } from "../core/eval/seal.ts";
import type { Item } from "../core/data/splits.ts";
import type { ReplayFixture } from "../core/jev/replay.ts";
import { criteriaV0, devItems, ops, replayFixtureUrls } from "./data.ts";
import { loadPref, savePref, loadLedger } from "./lib/storage.ts";
import type { WorkerRequest } from "./workers/run.worker.ts";

export type Tab = "map" | "gate" | "items";
export type BackendChoice = "mock" | "replay" | "live";
export type MobilePanel = "pair" | "diff" | "history";

export interface Version {
  id: string;
  n: number;
  texts: CriteriaTexts;
  criteria: Record<string, Criterion>;
  hash: string;
  parent: string | null;
  createdAt: number;
  changed: string[];
  restoredFrom?: string;
}

export interface ActiveRun {
  runId: number;
  versionId: string;
  hash: string;
  backend: BackendChoice;
  split: "dev" | "test";
  total: number;
  done: number;
  /** Revealed so far (paced for readability). */
  results: Record<string, ItemResult>;
  baseKey: string | null;
}

export interface LiveHealth {
  live: boolean;
  preset?: string;
  model?: string;
  budgetUsd?: number;
  spentUsd?: number;
}

export interface Toast {
  id: number;
  kind: "info" | "error" | "success";
  text: string;
}

export interface State {
  ready: boolean;
  versions: Version[];
  currentId: string | null;
  /** Version shown in the map and rails (normally the current one). */
  viewId: string | null;
  runs: Record<string, RunRecord>;
  active: ActiveRun | null;
  /** Run shown as "before" in the diff. */
  compareKey: string | null;
  drafts: Record<string, OptionText>;
  pair: [string, string] | null;
  hoverPair: string | null;
  focusOp: string | null;
  itemId: string | null;
  tab: Tab;
  topK: number;
  deleteOnly: boolean;
  tau: number;
  riskWeight: number;
  backend: BackendChoice;
  mobilePanel: MobilePanel;
  rightDrawer: boolean;
  shortcuts: boolean;
  sealOpen: boolean;
  exportOpen: boolean;
  seal: { status: "sealed" | "running" | "done" | "error"; ledger: LedgerRow[]; testRun: RunRecord | null; testItems: Item[] | null; error?: string };
  health: LiveHealth | null;
  toasts: Toast[];
  /** Replay fixtures are loaded (for REPLAY). */
  replayReady: boolean;
}

export const runKey = (hash: string, backend: BackendChoice, split: "dev" | "test", model = "") => `${hash}|${backend}${model ? ":" + model : ""}|${split}`;

export const useStore = create<State>(() => ({
  ready: false,
  versions: [],
  currentId: null,
  viewId: null,
  runs: {},
  active: null,
  compareKey: null,
  drafts: {},
  pair: null,
  hoverPair: null,
  focusOp: null,
  itemId: null,
  tab: loadPref<Tab>("tab", "map", (v) => ["map", "gate", "items"].includes(v as string)),
  topK: loadPref<number>("topK", 40, (v) => typeof v === "number" && v >= 10 && v <= 200),
  deleteOnly: false,
  tau: loadPref<number>("tau", 0.5, (v) => typeof v === "number" && v >= 0 && v <= 1),
  riskWeight: loadPref<number>("riskWeight", 10, (v) => typeof v === "number" && v >= 1 && v <= 100),
  backend: "mock",
  mobilePanel: "pair",
  rightDrawer: false,
  shortcuts: false,
  sealOpen: false,
  exportOpen: false,
  seal: { status: "sealed", ledger: loadLedger(), testRun: null, testItems: null },
  health: null,
  toasts: [],
  replayReady: false,
}));

const set = useStore.setState;
const get = useStore.getState;

// ---------- selectors ----------

export function currentVersion(s: State = get()): Version | null {
  return s.versions.find((v) => v.id === s.currentId) ?? null;
}
export function viewVersion(s: State = get()): Version | null {
  return s.versions.find((v) => v.id === s.viewId) ?? null;
}
export function modelFor(backend: BackendChoice, s: State = get()): string {
  if (backend === "live") return s.health?.model ?? "jev-1.13.0";
  return "mock-lexsim-1";
}
export function displayKeyFor(s: State = get()): string | null {
  const v = viewVersion(s);
  if (!v) return null;
  return runKey(v.hash, s.backend, "dev", s.backend === "live" ? modelFor("live", s) : "");
}

/** Effective text of an option: draft if edited, else the current version. */
export function effectiveText(opId: string, s: State = get()): OptionText {
  return s.drafts[opId] ?? currentVersion(s)?.texts[opId] ?? {};
}

// ---------- UI actions ----------

let toastId = 1;
export function toast(text: string, kind: Toast["kind"] = "info") {
  const t = { id: toastId++, kind, text };
  set((s) => ({ toasts: [...s.toasts, t] }));
  setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== t.id) })), kind === "error" ? 6000 : 3500);
}

export function setTab(tab: Tab) {
  set({ tab });
  savePref("tab", tab);
}
export function setTopK(topK: number) {
  set({ topK });
  savePref("topK", topK);
}
export function setTau(tau: number) {
  set({ tau: Math.round(Math.min(1, Math.max(0, tau)) * 1000) / 1000 });
  savePref("tau", get().tau);
}
export function setRiskWeight(w: number) {
  const riskWeight = Math.min(100, Math.max(1, Math.round(w)));
  set({ riskWeight });
  savePref("riskWeight", riskWeight);
}

export function selectPair(a: string, b: string) {
  set({ pair: [a, b], focusOp: null, mobilePanel: "pair" });
}
export function clearSelection() {
  set({ pair: null, focusOp: null, hoverPair: null });
}

export function setDraft(opId: string, patch: Partial<OptionText>) {
  const base = effectiveText(opId);
  set((s) => ({ drafts: { ...s.drafts, [opId]: { ...base, ...patch } } }));
}

export function dirtyOptions(s: State = get()): string[] {
  const cur = currentVersion(s);
  if (!cur) return [];
  const merged = { ...cur.texts, ...s.drafts };
  return changedOptions(cur.texts, merged);
}

export function revertDrafts(ids?: string[]) {
  set((s) => {
    if (!ids) return { drafts: {} };
    const d = { ...s.drafts };
    for (const id of ids) delete d[id];
    return { drafts: d };
  });
}

// ---------- versions and runs ----------

async function makeVersion(texts: CriteriaTexts, parent: Version | null, restoredFrom?: string): Promise<Version> {
  const criteria = toChoiceCriteria(ops, texts);
  const hash = await criteriaHash(criteria);
  const n = get().versions.length;
  return {
    id: `v${n}`,
    n,
    texts,
    criteria,
    hash,
    parent: parent?.id ?? null,
    createdAt: Date.now(),
    changed: parent ? changedOptions(parent.texts, texts) : [],
    restoredFrom,
  };
}

export async function init() {
  if (get().ready || get().versions.length) return;
  const v0 = await makeVersion(textsFromChoiceCriteria(criteriaV0), null);
  set({ versions: [v0], currentId: v0.id, viewId: v0.id, ready: true });
  void refreshHealth();
  void startRun(v0, { baseKey: null });
}

/** Save drafts as a new version and rerun dev. */
export async function saveAndRerun() {
  const s = get();
  const cur = currentVersion(s);
  if (!cur || s.active) return;
  const dirty = dirtyOptions(s);
  if (!dirty.length) {
    toast("Nothing to save: no option text changed.");
    return;
  }
  const texts = { ...cur.texts, ...s.drafts };
  const v = await makeVersion(texts, cur);
  // compare against the run of the version the edit started from (not a version merely being viewed)
  const baseKey = runKey(cur.hash, s.backend, "dev", s.backend === "live" ? modelFor("live", s) : "");
  set((st) => ({ versions: [...st.versions, v], currentId: v.id, viewId: v.id, drafts: {} }));
  await startRun(v, { baseKey, edited: dirty });
}

/** Make an earlier version current again. A version that ran before costs nothing (cached run). */
export async function restoreVersion(id: string) {
  const s = get();
  const target = s.versions.find((v) => v.id === id);
  const cur = currentVersion(s);
  if (!target || !cur || target.id === cur.id || s.active) return;
  const baseKey = displayKeyFor(s);
  const v = await makeVersion(target.texts, cur, target.id);
  set((st) => ({ versions: [...st.versions, v], currentId: v.id, viewId: v.id, drafts: {} }));
  await startRun(v, { baseKey });
}

/** Show a version and its diff against its parent, without making it current. */
export function viewVersionById(id: string) {
  const s = get();
  const v = s.versions.find((x) => x.id === id);
  if (!v) return;
  const parent = s.versions.find((x) => x.id === v.parent);
  const model = s.backend === "live" ? modelFor("live") : "";
  set({ viewId: v.id, compareKey: parent ? runKey(parent.hash, s.backend, "dev", model) : null });
  if (!s.runs[runKey(v.hash, s.backend, "dev", model)]) void startRun(v, { baseKey: parent ? runKey(parent.hash, s.backend, "dev", model) : null });
}

export async function setBackend(backend: BackendChoice) {
  const s = get();
  if (s.active || backend === s.backend) return;
  if (backend === "live" && !s.health?.live) {
    toast("LIVE needs the local server: run `npm run live` with an API key set.", "error");
    return;
  }
  if (backend === "replay") await ensureReplayFixtures();
  set({ backend, compareKey: null });
  const v = viewVersion(get());
  if (v && !get().runs[displayKeyFor(get())!]) await startRun(v, { baseKey: null });
}

export async function refreshHealth() {
  try {
    // Static builds have no local server, so LIVE stays off without probing (no failed request in the console).
    if (!import.meta.env.DEV) throw new Error("static build");
    const res = await fetch("/api/health", { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(String(res.status));
    const j = (await res.json()) as LiveHealth;
    set({ health: j && j.live ? j : { live: false } });
  } catch {
    set({ health: { live: false } });
  }
}

// ---------- run controller ----------

let worker: Worker | null = null;
let runSeq = 0;
function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./workers/run.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = onWorkerMessage;
  }
  return worker;
}

async function ensureReplayFixtures() {
  if (get().replayReady) return;
  const fixtures: ReplayFixture[] = [];
  for (const load of Object.values(replayFixtureUrls)) {
    const url = await load();
    fixtures.push((await (await fetch(url)).json()) as ReplayFixture);
  }
  getWorker().postMessage({ type: "replay-fixtures", fixtures } satisfies WorkerRequest);
  set({ replayReady: true });
}

const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Pacing queue: results are revealed over ≤ ~1.2 s for readability. Wall time is measured by the runner, not here. */
let pending: ItemResult[] = [];
let pacer: ReturnType<typeof setInterval> | null = null;
let finishing: { runId: number; record: RunRecord; resolve: () => void } | null = null;

function startPacer(total: number) {
  stopPacer();
  const perTick = reducedMotion() ? Infinity : Math.max(1, Math.ceil(total / 12));
  pacer = setInterval(() => {
    const a = get().active;
    if (!a) return stopPacer();
    if (pending.length) {
      const batch = pending.splice(0, perTick === Infinity ? pending.length : perTick);
      const results = { ...a.results };
      for (const r of batch) results[r.id] = r;
      set({ active: { ...a, results, done: Object.keys(results).length } });
    }
    if (!pending.length && finishing && finishing.runId === a.runId) {
      const f = finishing;
      finishing = null;
      finalize(f.record);
      f.resolve();
    }
  }, 100);
}
function stopPacer() {
  if (pacer) clearInterval(pacer);
  pacer = null;
}

function finalize(record: RunRecord) {
  const s = get();
  const a = s.active;
  if (!a) return;
  const key = runKey(a.hash, a.backend, a.split, a.backend === "live" ? record.model : "");
  stopPacer();
  if (a.split === "test") {
    set({ active: null, seal: { ...s.seal, testRun: record } });
  } else {
    set({ active: null, runs: { ...s.runs, [key]: record } });
  }
  const done = pendingDone.get(a.runId);
  pendingDone.delete(a.runId);
  done?.(record);
}

const pendingDone = new Map<number, (r: RunRecord) => void>();

function onWorkerMessage(ev: MessageEvent) {
  const m = ev.data as
    | { type: "result"; runId: number; result: ItemResult; done: number; total: number }
    | { type: "done"; runId: number; record: RunRecord }
    | { type: "failed"; runId: number; message: string };
  const a = get().active;
  if (!a || m.runId !== a.runId) return;
  if (m.type === "result") pending.push(m.result);
  else if (m.type === "done") {
    finishing = { runId: m.runId, record: m.record, resolve: () => undefined };
  } else {
    stopPacer();
    set({ active: null });
    toast(`Run failed: ${m.message}`, "error");
  }
}

export interface StartRunOptions {
  baseKey: string | null;
  edited?: string[];
  split?: "dev" | "test";
  items?: Item[];
}

/** Run a version on the selected backend. Resolves with the finished record. */
export function startRun(v: Version, o: StartRunOptions): Promise<RunRecord> {
  const s = get();
  const split = o.split ?? "dev";
  const items = o.items ?? devItems;
  const backend = s.backend;
  const model = modelFor(backend, s);
  const key = runKey(v.hash, backend, split, backend === "live" ? model : "");
  const cached = split === "dev" ? s.runs[key] : undefined;
  if (split === "dev") set({ compareKey: o.baseKey && o.baseKey !== key ? o.baseKey : null });
  if (cached) return Promise.resolve(cached);
  const base = o.baseKey ? s.runs[o.baseKey] ?? null : null;
  const order = priorityOrder(items, base, o.edited ?? []);
  const runId = ++runSeq;
  pending = [];
  finishing = null;
  set({ active: { runId, versionId: v.id, hash: v.hash, backend, split, total: items.length, done: 0, results: {}, baseKey: o.baseKey } });
  startPacer(items.length);
  const promise = new Promise<RunRecord>((resolve) => pendingDone.set(runId, resolve));
  if (backend === "live") {
    const http = createHttpBackend({ baseUrl: "", path: "/api/systemone", label: `${model} · live`, retry: { maxRetries: 0 }, timeoutMs: 60_000 });
    void runItems({
      backend: http,
      items,
      criteria: v.criteria,
      criteriaHash: v.hash,
      criteriaVersion: v.id,
      model,
      split,
      order,
      concurrency: 6,
      onResult: (r) => pending.push(r),
    }).then((record) => {
      finishing = { runId, record: { ...record, backendLabel: `${record.model} · live` }, resolve: () => undefined };
      void refreshHealth();
    });
  } else {
    getWorker().postMessage({
      type: "run",
      runId,
      backend,
      items,
      criteria: v.criteria,
      criteriaHash: v.hash,
      criteriaVersion: v.id,
      model,
      split,
      order,
    } satisfies WorkerRequest);
  }
  return promise;
}

/** A merged view of the active run over its base run, so the map morphs item by item. */
export function mergedRun(s: State): RunRecord | null {
  const key = displayKeyFor(s);
  const a = s.active;
  if (a && a.split === "dev" && a.versionId === s.viewId) {
    const base = a.baseKey ? s.runs[a.baseKey] : null;
    const options = base?.options ?? Object.keys(viewVersion(s)!.criteria);
    const baseById = new Map(base?.results.map((r) => [r.id, r]) ?? []);
    const results = devItems.map((it) => a.results[it.id] ?? baseById.get(it.id)).filter((r): r is ItemResult => !!r);
    return {
      kind: "crosstalk-run",
      criteriaHash: a.hash,
      criteriaVersion: a.versionId,
      backend: a.backend === "live" ? "http" : a.backend,
      backendLabel: "",
      model: modelFor(a.backend, s),
      split: "dev",
      options,
      results,
      startedAt: "",
      wallMs: 0,
      runHash: "",
      errors: results.filter((r) => r.error).length,
      inputTokens: 0,
      costUsd: 0,
      costSource: "estimated",
    };
  }
  return key ? s.runs[key] ?? null : null;
}

export { runHashOf };
