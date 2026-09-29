/**
 * One store (Zustand). Slices: criteria versions, runs, the active run, selection, UI, seal, live health.
 * The run controller at the bottom sends jobs to the Web Worker (MOCK, REPLAY) or to the local server (LIVE).
 *
 * Run rules:
 *  - one run at a time; every entry point checks `active` (and startRun refuses a second run);
 *  - streamed results, completion and failure are scoped to their runId, so a late message from an old run
 *    can never land in a newer one;
 *  - runs are keyed by criteria hash, backend, split and the REQUESTED model (a server may report another);
 *  - a finished run with failed items is kept (the UI shows it as partial) but is not a final cached result:
 *    the next time it is needed, only its failed items run again and are merged in.
 */
import { create } from "zustand";
import { changedOptions, criteriaHash, type CriteriaTexts, type OptionText, textsFromChoiceCriteria, toChoiceCriteria } from "../core/data/criteria.ts";
import type { Criterion, DecideOptions, DecideRequest, DecisionBackend } from "../core/jev/types.ts";
import { priorityOrder, runHashOf, runItems, type ItemResult, type RunRecord } from "../core/run/runner.ts";
import { createHttpBackend } from "../core/jev/http.ts";
import { CrosstalkError, HttpError } from "../core/jev/errors.ts";
import type { LedgerRow } from "../core/eval/seal.ts";
import type { Item } from "../core/data/splits.ts";
import type { ReplayFixture } from "../core/jev/replay.ts";
import { criteriaV0, devItems, ops, replayFixtureUrls } from "./data.ts";
import { loadPref, savePref, loadLedger, storageWorks } from "./lib/storage.ts";
import { summarizeFailures } from "./lib/errors.ts";
import type { WorkerRequest } from "./workers/run.worker.ts";

export type Tab = "map" | "gate" | "items";
export type BackendChoice = "mock" | "replay" | "live";
export type MobilePanel = "pair" | "diff" | "history";
/** Which chords the map and the Pairs list rank: operation⇄operation look-alikes, NO MATCH spokes, or both. */
export type Lens = "ops" | "hub" | "all";

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
  /** Requested model. */
  model: string;
  split: "dev" | "test";
  total: number;
  done: number;
  /** Revealed so far (paced for readability). */
  results: Record<string, ItemResult>;
  baseKey: string | null;
  /** Set when this run only retries the failed items of an earlier run (stored under this key). */
  retryKey: string | null;
}

export interface LiveHealth {
  live: boolean;
  preset?: string;
  model?: string;
  budgetUsd?: number;
  spentUsd?: number;
  reservedUsd?: number;
  token?: string;
}

export interface Toast {
  id: number;
  kind: "info" | "error" | "success";
  text: string;
}

export interface SealState {
  status: "sealed" | "running" | "done" | "error";
  ledger: LedgerRow[];
  /** The last test run, with its own criteria hash, version, backend and model. */
  testRun: RunRecord | null;
  testItems: Item[] | null;
  error?: string;
  /** False when browser storage is blocked: peeks are counted for this page only. */
  persisted: boolean;
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
  lens: Lens;
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
  moreOpen: boolean;
  seal: SealState;
  health: LiveHealth | null;
  toasts: Toast[];
  /** Replay fixtures are loaded (for REPLAY). */
  replayReady: boolean;
}

export const runKey = (hash: string, backend: BackendChoice, split: "dev" | "test", model = "") => `${hash}|${backend}${model ? ":" + model : ""}|${split}`;

export const DEFAULT_TOP_K = 20;

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
  lens: loadPref<Lens>("lens", "ops", (v) => ["ops", "hub", "all"].includes(v as string)),
  topK: loadPref<number>("topK:v2", DEFAULT_TOP_K, (v) => typeof v === "number" && v >= 5 && v <= 200),
  deleteOnly: false,
  tau: loadPref<number>("tau", 0.5, (v) => typeof v === "number" && v >= 0 && v <= 1),
  riskWeight: loadPref<number>("riskWeight", 10, (v) => typeof v === "number" && v >= 1 && v <= 100),
  backend: "mock",
  mobilePanel: "pair",
  rightDrawer: false,
  shortcuts: false,
  sealOpen: false,
  exportOpen: false,
  moreOpen: false,
  seal: { status: "sealed", ledger: loadLedger(), testRun: null, testItems: null, persisted: storageWorks() },
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
/** True while an older version is shown: the editor is read-only until it is restored. */
export function isViewingOld(s: State = get()): boolean {
  return !!s.viewId && s.viewId !== s.currentId;
}
/** The model a run on this backend requests (LIVE: the model the local server is pinned to). */
export function modelFor(backend: BackendChoice, s: State = get()): string {
  if (backend === "live") return s.health?.model ?? "jev-1.13.0";
  return "mock-lexsim-1";
}
export function keyFor(hash: string, backend: BackendChoice, split: "dev" | "test", s: State = get()): string {
  return runKey(hash, backend, split, backend === "live" ? modelFor("live", s) : "");
}
export function displayKeyFor(s: State = get()): string | null {
  const v = viewVersion(s);
  return v ? keyFor(v.hash, s.backend, "dev", s) : null;
}
export function backendChoiceOf(kind: RunRecord["backend"]): BackendChoice {
  return kind === "http" ? "live" : kind;
}
/** The stored dev run that matches a test run exactly: same criteria hash, backend and requested model. */
export function devRunFor(test: RunRecord, s: State = get()): RunRecord | null {
  const b = backendChoiceOf(test.backend);
  return s.runs[runKey(test.criteriaHash, b, "dev", b === "live" ? test.model : "")] ?? null;
}
export function versionByHash(hash: string, s: State = get()): Version | null {
  return s.versions.find((v) => v.hash === hash) ?? null;
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
  setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== t.id) })), kind === "error" ? 9000 : 3500);
}

export function setTab(tab: Tab) {
  set({ tab });
  savePref("tab", tab);
}
export function setLens(lens: Lens) {
  set({ lens, hoverPair: null });
  savePref("lens", lens);
}
export function setTopK(topK: number) {
  set({ topK });
  savePref("topK:v2", topK);
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
  if (isViewingOld()) return;
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
  void startRun(v0, { baseKey: null }).catch(() => undefined);
}

/** Save drafts as a new version and rerun dev. */
export async function saveAndRerun() {
  const s = get();
  const cur = currentVersion(s);
  if (!cur || s.active) return;
  if (isViewingOld(s)) {
    toast(`Viewing ${s.viewId} (read only). Restore it, or go back to the current version, to edit.`);
    return;
  }
  const dirty = dirtyOptions(s);
  if (!dirty.length) {
    toast("Nothing to save: no option text changed.");
    return;
  }
  const texts = { ...cur.texts, ...s.drafts };
  const v = await makeVersion(texts, cur);
  // compare against the run of the version the edit started from
  const baseKey = keyFor(cur.hash, s.backend, "dev", s);
  set((st) => ({ versions: [...st.versions, v], currentId: v.id, viewId: v.id, drafts: {} }));
  await startRun(v, { baseKey, edited: dirty }).catch(() => undefined);
}

/** Make an earlier version current again. A version that ran before (with no failed items) costs nothing. */
export async function restoreVersion(id: string) {
  const s = get();
  const target = s.versions.find((v) => v.id === id);
  const cur = currentVersion(s);
  if (!target || !cur || target.id === cur.id || s.active) return;
  const baseKey = keyFor(cur.hash, s.backend, "dev", s);
  const v = await makeVersion(target.texts, cur, target.id);
  set((st) => ({ versions: [...st.versions, v], currentId: v.id, viewId: v.id, drafts: {} }));
  await startRun(v, { baseKey }).catch(() => undefined);
}

/** Show a version and its diff against its parent, without making it current. Never during a run. */
export function viewVersionById(id: string) {
  const s = get();
  const v = s.versions.find((x) => x.id === id);
  if (!v) return;
  if (s.active) {
    toast("A run is in progress. Wait for it to finish, then open another version.");
    return;
  }
  const parent = s.versions.find((x) => x.id === v.parent);
  const parentKey = parent ? keyFor(parent.hash, s.backend, "dev", s) : null;
  set({ viewId: v.id, compareKey: parentKey });
  const r = s.runs[keyFor(v.hash, s.backend, "dev", s)];
  if (!r || r.errors > 0) void startRun(v, { baseKey: parentKey }).catch(() => undefined);
}

export async function setBackend(backend: BackendChoice) {
  const s = get();
  if (s.active || backend === s.backend) return;
  if (backend === "live" && !s.health?.live) {
    toast("LIVE needs the local server: run `npm run live` with an API key set.", "error");
    return;
  }
  if (backend === "replay") {
    try {
      await ensureReplayFixtures();
    } catch (e) {
      toast(`Replay fixtures could not be loaded (${(e as Error).message}). Staying on ${get().backend.toUpperCase()}.`, "error");
      return;
    }
  }
  set({ backend, compareKey: null });
  const v = viewVersion(get());
  const r = v ? get().runs[displayKeyFor(get())!] : undefined;
  if (v && (!r || r.errors > 0)) await startRun(v, { baseKey: null }).catch(() => undefined);
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

/** Rerun only the failed items of the displayed run and merge them in. */
export async function retryFailed() {
  const s = get();
  const v = viewVersion(s);
  const key = displayKeyFor(s);
  if (!v || !key || s.active) return;
  const r = s.runs[key];
  if (!r || r.errors === 0) return;
  if (s.backend === "live") await refreshHealth();
  await startRun(v, { baseKey: s.compareKey }).catch(() => undefined);
}

// ---------- run controller ----------

let worker: Worker | null = null;
let runSeq = 0;
function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./workers/run.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = onWorkerMessage;
    const crashed = (why: string) => {
      worker?.terminate();
      worker = null;
      set({ replayReady: false });
      if (ctl) fail(ctl.runId, why);
    };
    worker.onerror = (e) => {
      e.preventDefault();
      crashed(`the run worker crashed (${e.message || "error"})`);
    };
    worker.onmessageerror = () => crashed("the run worker sent a message that could not be read");
  }
  return worker;
}

async function ensureReplayFixtures() {
  if (get().replayReady) return;
  const fixtures: ReplayFixture[] = [];
  for (const load of Object.values(replayFixtureUrls)) {
    const url = await load();
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    fixtures.push((await res.json()) as ReplayFixture);
  }
  getWorker().postMessage({ type: "replay-fixtures", fixtures } satisfies WorkerRequest);
  set({ replayReady: true });
}

const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The one run in flight. Everything that arrives for another runId is dropped. */
interface RunCtl {
  runId: number;
  /** Results waiting to be revealed (paced for readability; wall time is measured by the runner, not here). */
  pending: ItemResult[];
  finishing: RunRecord | null;
  resolve: (r: RunRecord) => void;
  reject: (e: Error) => void;
  retryOf: RunRecord | null;
  healthTimer: ReturnType<typeof setInterval> | null;
}
let ctl: RunCtl | null = null;
let pacer: ReturnType<typeof setInterval> | null = null;

function startPacer(total: number) {
  stopPacer();
  const perTick = reducedMotion() ? Infinity : Math.max(1, Math.ceil(total / 12));
  pacer = setInterval(() => {
    const a = get().active;
    const c = ctl;
    if (!a || !c || c.runId !== a.runId) return stopPacer();
    if (c.pending.length) {
      const batch = c.pending.splice(0, perTick === Infinity ? c.pending.length : perTick);
      const results = { ...a.results };
      for (const r of batch) results[r.id] = r;
      set({ active: { ...a, results, done: Object.keys(results).length } });
    }
    if (!c.pending.length && c.finishing) finalize(c, c.finishing);
  }, 100);
}
function stopPacer() {
  if (pacer) clearInterval(pacer);
  pacer = null;
}

function endCtl(c: RunCtl) {
  if (c.healthTimer) clearInterval(c.healthTimer);
  if (ctl === c) ctl = null;
  stopPacer();
}

function finalize(c: RunCtl, record: RunRecord) {
  const s = get();
  const a = s.active;
  endCtl(c);
  if (!a || a.runId !== c.runId) return;
  const key = a.retryKey ?? runKey(a.hash, a.backend, a.split, a.backend === "live" ? a.model : "");
  if (a.split === "test") set({ active: null, seal: { ...s.seal, testRun: record } });
  else set({ active: null, runs: { ...s.runs, [key]: record } });
  const f = summarizeFailures(record.results);
  if (f) toast(f.sentence, "error");
  if (record.reportedModels?.length)
    toast(`The server answered as ${record.reportedModels.join(", ")}, not ${record.model}. The run is stored under ${record.model}, the model that was requested.`);
  if (a.backend === "live") void refreshHealth();
  c.resolve(record);
}

/** A run that could not finish at all (worker crash, network failure of the whole run). */
function fail(runId: number, message: string) {
  const c = ctl;
  if (!c || c.runId !== runId) return;
  endCtl(c);
  if (get().active?.runId === runId) set({ active: null });
  toast(`Run failed: ${message}`, "error");
  c.reject(new Error(message));
}

/** Once a run's record is complete: merge a retry into the run it retried, then let the pacer finish it. */
async function complete(runId: number, record: RunRecord) {
  const c = ctl;
  if (!c || c.runId !== runId) return;
  try {
    const full = c.retryOf ? await mergeRetry(c.retryOf, record) : record;
    if (ctl === c) c.finishing = full;
  } catch (e) {
    fail(runId, (e as Error).message);
  }
}

async function mergeRetry(base: RunRecord, retry: RunRecord): Promise<RunRecord> {
  const byId = new Map(retry.results.map((r) => [r.id, r]));
  const results = base.results.map((r) => byId.get(r.id) ?? r);
  const sources = new Set(results.filter((r) => r.costSource).map((r) => r.costSource));
  const reported = new Set([...(base.reportedModels ?? []), ...(retry.reportedModels ?? [])]);
  const merged: RunRecord = {
    ...base,
    results,
    reportedModels: reported.size ? [...reported].sort() : undefined,
    wallMs: base.wallMs + retry.wallMs,
    errors: results.filter((r) => r.error).length,
    inputTokens: results.reduce((a, r) => a + r.inputTokens, 0),
    costUsd: results.reduce((a, r) => a + (r.costUsd ?? 0), 0),
    costSource: sources.size === 1 ? ([...sources][0] as RunRecord["costSource"]) : sources.size === 0 ? "estimated" : "mixed",
  };
  if (!merged.reportedModels) delete merged.reportedModels;
  return { ...merged, runHash: await runHashOf(merged) };
}

function onWorkerMessage(ev: MessageEvent) {
  const m = ev.data as
    | { type: "result"; runId: number; result: ItemResult; done: number; total: number }
    | { type: "done"; runId: number; record: RunRecord }
    | { type: "failed"; runId: number; message: string };
  if (!ctl || m.runId !== ctl.runId) return;
  if (m.type === "result") ctl.pending.push(m.result);
  else if (m.type === "done") void complete(m.runId, m.record);
  else fail(m.runId, m.message);
}

/** The browser's LIVE backend: the local proxy, with its token. Proxy error codes become item error codes. */
function liveBackend(model: string, token: string | undefined): DecisionBackend {
  const http = createHttpBackend({
    baseUrl: "",
    path: "/api/systemone",
    label: `${model} · live`,
    retry: { maxRetries: 0 },
    timeoutMs: 60_000,
    extraHeaders: token ? { "x-crosstalk-token": token } : {},
  });
  return {
    kind: "http",
    label: http.label,
    async decide(req: DecideRequest, opts?: DecideOptions) {
      try {
        return await http.decide(req, opts);
      } catch (e) {
        const body = e instanceof HttpError ? (e.body as { code?: unknown; error?: unknown } | null) : null;
        if (body && typeof body.code === "string") throw new CrosstalkError(body.code, typeof body.error === "string" ? body.error : (e as Error).message);
        throw e;
      }
    },
  };
}

export interface StartRunOptions {
  baseKey: string | null;
  edited?: string[];
  split?: "dev" | "test";
  items?: Item[];
}

/**
 * Run a version on the selected backend. Resolves with the finished record; rejects if the run cannot finish
 * or another run is active. A stored dev run with no failed items is returned as is (it costs nothing); one with
 * failed items reruns only those items and merges them in.
 */
export function startRun(v: Version, o: StartRunOptions): Promise<RunRecord> {
  const s = get();
  if (s.active || ctl) return Promise.reject(new Error("a run is already in progress"));
  const split = o.split ?? "dev";
  const backend = s.backend;
  const model = modelFor(backend, s);
  const key = runKey(v.hash, backend, split, backend === "live" ? model : "");
  const stored = split === "dev" ? s.runs[key] : undefined;
  if (split === "dev") set({ compareKey: o.baseKey && o.baseKey !== key ? o.baseKey : null });
  if (stored && stored.errors === 0) return Promise.resolve(stored);
  const all = o.items ?? devItems;
  const failedIds = stored ? new Set(stored.results.filter((r) => r.error).map((r) => r.id)) : null;
  const items = failedIds ? all.filter((it) => failedIds.has(it.id)) : all;
  const base = o.baseKey ? s.runs[o.baseKey] ?? null : null;
  const order = priorityOrder(items, base, o.edited ?? []);
  const runId = ++runSeq;
  let c!: RunCtl;
  const promise = new Promise<RunRecord>((resolve, reject) => {
    c = { runId, pending: [], finishing: null, resolve, reject, retryOf: stored ?? null, healthTimer: null };
  });
  ctl = c;
  set({
    active: { runId, versionId: v.id, hash: v.hash, backend, model, split, total: items.length, done: 0, results: {}, baseKey: o.baseKey, retryKey: stored ? key : null },
  });
  startPacer(items.length);
  if (backend === "live") {
    // Refresh spend in the top bar while the run streams.
    c.healthTimer = setInterval(() => void refreshHealth(), 2000);
    runItems({
      backend: liveBackend(model, s.health?.token),
      items,
      criteria: v.criteria,
      criteriaHash: v.hash,
      criteriaVersion: v.id,
      model,
      split,
      order,
      concurrency: 6,
      onResult: (r) => {
        if (ctl === c) c.pending.push(r);
      },
    })
      .then((record) => complete(runId, { ...record, backendLabel: `${record.model} · live` }))
      .catch((e: Error) => fail(runId, e.message));
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
    const baseKey = a.retryKey ?? a.baseKey;
    const base = baseKey ? s.runs[baseKey] : null;
    const options = base?.options ?? Object.keys(viewVersion(s)!.criteria);
    const baseById = new Map(base?.results.map((r) => [r.id, r]) ?? []);
    const results = devItems.map((it) => a.results[it.id] ?? baseById.get(it.id)).filter((r): r is ItemResult => !!r);
    return {
      kind: "crosstalk-run",
      criteriaHash: a.hash,
      criteriaVersion: a.versionId,
      backend: a.backend === "live" ? "http" : a.backend,
      backendLabel: "",
      model: a.model,
      split: "dev",
      options,
      results,
      startedAt: "",
      wallMs: 0,
      // empty while streaming: exports and the Gate refuse a run without a hash
      runHash: "",
      errors: results.filter((r) => r.error).length,
      inputTokens: 0,
      costUsd: 0,
      costSource: "estimated",
    };
  }
  return key ? s.runs[key] ?? null : null;
}

/** Test hooks (no UI): lets store-level tests drive the controller without a Worker. */
export const __test = {
  get ctl() {
    return ctl;
  },
  complete,
  fail,
  finalize: (record: RunRecord) => ctl && finalize(ctl, record),
};

export { runHashOf };
