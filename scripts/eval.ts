/**
 * CLI eval.
 *   npm run eval -- --split dev --backend mock|replay|live [--criteria file.json] [--out runs/x.json]
 *   npm run eval -- --split test --unseal [--backend ...]     (checks the manifest hash; appends to ledger/test_runs.jsonl)
 * Live runs read the key from the environment (.env is loaded) and never print it.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createMockBackend } from "../src/core/jev/mock-lexsim.ts";
import { createReplayBackend } from "../src/core/jev/replay.ts";
import { createHttpBackend } from "../src/core/jev/http.ts";
import type { DecisionBackend } from "../src/core/jev/types.ts";
import { runItems } from "../src/core/run/runner.ts";
import { criteriaHash } from "../src/core/data/criteria.ts";
import { accuracy, riskWeighted, scoreRun, totalLeak, type Interval } from "../src/core/eval/metrics.ts";
import { computeLeakage } from "../src/core/eval/leakage.ts";
import { loadSealedSplit, parseLedger, recordPeek, type LedgerStore } from "../src/core/eval/seal.ts";
import { createLimiter } from "../src/core/run/limiter.ts";
import { Budget } from "../src/core/run/budget.ts";
import { withGuards } from "../src/core/run/guarded.ts";
import { DATA, loadCatalog, loadCriteria, loadDev, loadManifest, loadReplayStore } from "./_load.ts";
import { loadDotEnv, presetReady, resolvePreset } from "../server/presets.ts";

const args = process.argv.slice(2);
const opt = (name: string, dflt?: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const split = opt("split", "dev") as "dev" | "test";
const backendName = opt("backend", "mock")!;
const criteriaFile = opt("criteria", `${DATA}/criteria.v0.json`)!;
const unseal = args.includes("--unseal");
const weight = Number(opt("risk-weight", "10"));

const catalog = loadCatalog();
const criteria = loadCriteria(criteriaFile);
const cHash = await criteriaHash(criteria);
const manifest = loadManifest();

let items;
let testSha = "";
if (split === "test") {
  const r = await loadSealedSplit({ unseal, manifest, read: async () => readFileSync(`${DATA}/test.jsonl`) });
  items = r.items;
  testSha = r.sha256;
} else {
  items = loadDev();
}

let backend: DecisionBackend;
let model: string;
if (backendName === "mock") {
  backend = createMockBackend();
  model = "mock-lexsim-1";
} else if (backendName === "replay") {
  // Real cached responses are read only for the upstream the environment selects (default: typesafe).
  loadDotEnv();
  let preset: ReturnType<typeof resolvePreset> | undefined;
  try {
    preset = resolvePreset();
  } catch {
    preset = undefined;
  }
  backend = createReplayBackend(loadReplayStore(preset));
  model = opt("model", "mock-lexsim-1")!;
} else if (backendName === "live") {
  loadDotEnv();
  const p = resolvePreset();
  if (!presetReady(p)) {
    console.error(`LIVE needs ${p.keyEnv} in the environment or in .env`);
    process.exit(2);
  }
  model = p.model;
  const http = createHttpBackend({ baseUrl: p.baseUrl, apiKey: p.apiKey, label: `${p.model} · live`, logger: (l, m) => l !== "debug" && console.error(`[${l}] ${m}`) });
  const budget = new Budget(Number(process.env.CROSSTALK_BUDGET_USD ?? "0.50"));
  const limiter = createLimiter({ requestsPerMinute: 600, concurrency: 8 });
  backend = withGuards(http, limiter, budget);
} else {
  throw new Error(`unknown backend ${backendName}`);
}

const t0 = Date.now();
const run = await runItems({ backend, items, criteria, criteriaHash: cHash, model, split, concurrency: backendName === "live" ? 8 : 16 });
const scored = scoreRun(items, run);
const acc = accuracy(scored);
const deleteOps = new Set(catalog.operations.filter((o) => o.method === "DELETE").map((o) => o.id));
const risk = riskWeighted(scored, deleteOps, weight);
const leak = computeLeakage(items, run);

const pct = (x: number) => (Number.isFinite(x) ? (x * 100).toFixed(1) + "%" : "n/a");
const iv = (i: Interval) => `${pct(i.p)}  [${pct(i.lo)} – ${pct(i.hi)}]  (${i.k}/${i.n})`;
console.log(`\nCrosstalk eval · ${split} · ${run.backendLabel} · model ${run.model}`);
console.log(`criteria ${criteriaFile} · sha256 ${cHash.slice(0, 12)}… · run ${run.runHash.slice(0, 12)}…`);
if (backendName === "mock") console.log("MOCK · lexical stand-in, not Jev. Mock accuracy says nothing about any model.");
console.log("");
console.log(`top-1 accuracy      ${iv(acc.all)}`);
console.log(`  match             ${iv(acc.match)}`);
console.log(`  no match          ${iv(acc.noMatch)}`);
console.log(`risk-weighted error ${risk.per100.toFixed(1)} per 100 items (DELETE weight ${weight}; ${risk.wrongDelete} wrong picks were DELETE)`);
console.log(`total leaked mass   ${totalLeak(scored).toFixed(2)} items`);
console.log(`errors              ${acc.errors}`);
console.log(`input tokens        ${run.inputTokens.toLocaleString()} (${run.costSource})   cost $${run.costUsd.toFixed(5)}   wall ${(run.wallMs / 1000).toFixed(2)} s (process ${((Date.now() - t0) / 1000).toFixed(2)} s)`);
console.log("\ntop leaking pairs");
for (const p of leak.pairs.slice(0, 12)) {
  console.log(`  ${p.state.padEnd(10)} ${p.mass.toFixed(2).padStart(6)}  ${p.a} ⇄ ${p.b}  (errors ${p.errors}, near ${p.nearMiss})`);
}

const outPath = opt("out") ?? `runs/run-${split}-${cHash.slice(0, 12)}-${backendName}.json`;
mkdirSync("runs", { recursive: true });
writeFileSync(outPath, JSON.stringify(run) + "\n");
console.log(`\nwrote ${outPath}`);

if (split === "test") {
  const ledgerPath = "ledger/test_runs.jsonl";
  const store: LedgerStore = {
    read: async () => (existsSync(ledgerPath) ? parseLedger(readFileSync(ledgerPath, "utf8")) : []),
    append: async (row) => appendFileSync(ledgerPath, JSON.stringify(row) + "\n"),
  };
  const row = await recordPeek(store, {
    at: new Date().toISOString(),
    split: "test",
    testSha256: testSha,
    criteriaHash: cHash,
    backend: run.backend,
    model: run.model,
    n: acc.n,
    accuracy: acc.all.p,
    lo: acc.all.lo,
    hi: acc.all.hi,
    matchAccuracy: acc.match.p,
    noMatchAccuracy: acc.noMatch.p,
    riskPer100: risk.per100,
    errors: acc.errors,
    where: "cli",
  });
  console.log(`ledger: peek ${row.peek} recorded in ${ledgerPath}`);
}
