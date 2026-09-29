/**
 * Exports: criteria JSON ready for a /v1/systemone request, a Vitest regression file, the run JSON, and policy.json.
 * Pure TypeScript: returns { filename, content }; the caller writes or downloads it.
 */
import type { Criterion } from "../jev/types.ts";
import { toWire } from "../jev/wire.ts";
import { buildRequest, QUESTION_ID } from "../run/request.ts";
import { INSTRUCTIONS } from "../data/criteria.ts";
import type { RunRecord } from "../run/runner.ts";
import type { ItemDiff } from "./diff.ts";

export interface ExportFile {
  filename: string;
  content: string;
  mime: string;
}

/** The Choice `criteria` map. Validated against the wire schema before it is returned. */
export function exportCriteria(criteria: Record<string, Criterion>, version: string, model: string): ExportFile {
  toWire(buildRequest(criteria, "validation probe", model));
  return {
    filename: `criteria.twilio-v2010.${version}.json`,
    content: JSON.stringify(criteria, null, 2) + "\n",
    mime: "application/json",
  };
}

export interface RegressionOptions {
  version: string;
  criteria: Record<string, Criterion>;
  fixed: Pick<ItemDiff, "id" | "query" | "gold">[];
  backend: RunRecord["backend"];
  model: string;
}

/**
 * One Vitest case per item that flipped to fixed. Each asserts chosen === gold against the backend that produced
 * the fix; it never substitutes another backend:
 *  - mock:   the deterministic lexical mock. Exact.
 *  - replay: the committed replay fixtures (the same store the browser's REPLAY uses). Exact.
 *  - http:   the local live server (`npm run live`), paid, so the cases run only with CROSSTALK_LIVE_TESTS=1.
 *            Answers vary slightly between runs, so each case repeats (fresh calls past the first, bypassing
 *            the server's cache) and passes when gold wins at least MIN_WINS of REPEATS times.
 */
export function exportRegressions(o: RegressionOptions): ExportFile {
  const live = o.backend === "http";
  const cases = o.fixed
    .map((f) => `  it(${JSON.stringify(`${f.id}: ${f.query}`)}, () => check(${JSON.stringify(f.query)}, ${JSON.stringify(f.gold)})${live ? ", 180_000" : ""});`)
    .join("\n");
  const note =
    o.backend === "http"
      ? `Recorded against a LIVE backend (${o.model}). Paid: the cases are skipped unless CROSSTALK_LIVE_TESTS=1, and they call
 * the local server started with \`npm run live\` (CROSSTALK_PROXY_URL, default http://127.0.0.1:8787). Answers vary
 * slightly between runs, so each case repeats REPEATS times and passes when gold wins at least MIN_WINS times.`
      : o.backend === "replay"
        ? "Recorded against REPLAY: the committed fixtures in fixtures/replay/ (made by the lexical mock, not Jev). Exact."
        : "Recorded against the deterministic lexical mock (MOCK · lexical stand-in, not Jev). The assertions are exact.";
  const backendCode =
    o.backend === "http"
      ? `import { createHttpBackend } from "../../src/core/jev/http.ts";

const LIVE = process.env.CROSSTALK_LIVE_TESTS === "1";
const PROXY = process.env.CROSSTALK_PROXY_URL ?? "http://127.0.0.1:8787";
const REPEATS = Number(process.env.CROSSTALK_REPEATS ?? 5);
const MIN_WINS = Number(process.env.CROSSTALK_MIN_WINS ?? 4);

let token: Promise<string> | null = null;
async function serverToken(): Promise<string> {
  token ??= (async () => {
    const h = (await (await fetch(\`\${PROXY}/api/health\`)).json()) as { live?: boolean; model?: string; token?: string };
    if (!h.live || !h.token) throw new Error("the local server has no API key (live=false): start it with \`npm run live\`");
    if (h.model !== MODEL) throw new Error(\`the local server is pinned to \${h.model}; these cases were recorded with \${MODEL}\`);
    return h.token;
  })();
  return token;
}

async function check(query: string, gold: string) {
  const t = await serverToken();
  let wins = 0;
  for (let i = 0; i < REPEATS; i++) {
    const backend = createHttpBackend({
      baseUrl: PROXY,
      path: "/api/systemone",
      retry: { maxRetries: 0 },
      timeoutMs: 60_000,
      // the first call may be answered from the server's cache; the repeats are fresh, paid calls
      extraHeaders: { "x-crosstalk-token": t, ...(i > 0 ? { "x-crosstalk-cache": "bypass" } : {}) },
    });
    const res = await backend.decide(buildRequest(criteria, query, MODEL));
    const d = res.decisions[${JSON.stringify(QUESTION_ID)}];
    if (d?.kind === "choice" && d.chosen === gold) wins++;
  }
  expect(wins).toBeGreaterThanOrEqual(MIN_WINS);
}

const suite = LIVE ? describe : describe.skip;`
      : `${
          o.backend === "replay"
            ? `import { createReplayBackend } from "../../src/core/jev/replay.ts";
import { loadReplayStore } from "../../scripts/_load.ts";

const backend = createReplayBackend(loadReplayStore());`
            : `import { createMockBackend } from "../../src/core/jev/mock-lexsim.ts";

const backend = createMockBackend();`
        }

async function check(query: string, gold: string) {
  const res = await backend.decide(buildRequest(criteria, query, MODEL));
  const d = res.decisions[${JSON.stringify(QUESTION_ID)}];
  expect(d?.kind === "choice" && d.chosen).toBe(gold);
}

const suite = describe;`;
  const content = `/**
 * Crosstalk regression tests, criteria ${o.version}. Generated ${new Date().toISOString()}.
 * One case per item that flipped from wrong to right when ${o.version} was saved (backend: ${o.backend}).
 * Place this file in crosstalk-lab/tests/unit/ and run \`npm test\`.
 *
 * ${note}
 */
import { describe, expect, it } from "vitest";
import { buildRequest } from "../../src/core/run/request.ts";
import type { Criterion } from "../../src/core/jev/types.ts";
${backendCode}

const MODEL = ${JSON.stringify(o.model)};
// Instructions sent with every request: ${JSON.stringify(INSTRUCTIONS)}
const criteria: Record<string, Criterion> = ${JSON.stringify(o.criteria, null, 2)};

suite("crosstalk regressions ${o.version} (${o.backend})", () => {
${cases || '  it.todo("no items flipped to fixed in this version");'}
});
`;
  return { filename: `regressions.${o.version}.test.ts`, content, mime: "text/typescript" };
}

export function exportRun(run: RunRecord): ExportFile {
  return {
    filename: `run-${run.criteriaHash.slice(0, 12)}-${run.backend}.json`,
    content: JSON.stringify(run) + "\n",
    mime: "application/json",
  };
}

export interface PolicyInput {
  tau: number;
  /** sha256 of the finished run the metrics come from. */
  runHash: string;
  model: string;
  backend: RunRecord["backend"];
  criteriaHash: string;
  criteriaVersion: string;
  confidenceSource: string;
  dev: { n: number; coverage: number; autoAccuracy: number; autoLo: number; autoHi: number; confidentErrors: number; riskConfidentErrors: number; riskWeight: number };
}

export function exportPolicy(p: PolicyInput): ExportFile {
  const body = {
    kind: "crosstalk-gate-policy",
    rule: "AUTO when confidence >= threshold; otherwise HUMAN. Items that errored always go to HUMAN.",
    threshold: p.tau,
    model: p.model,
    backend: p.backend,
    criteria: { version: p.criteriaVersion, sha256: p.criteriaHash },
    run: { sha256: p.runHash },
    confidence: p.confidenceSource,
    devMetrics: p.dev,
    createdAt: new Date().toISOString(),
    note:
      p.backend === "mock"
        ? "MOCK · lexical stand-in, not Jev. Its probabilities are not calibrated; this shows the method only."
        : "Tune thresholds against a pinned model version.",
  };
  return { filename: "policy.json", content: JSON.stringify(body, null, 2) + "\n", mime: "application/json" };
}
