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
 * One Vitest case per item that flipped to fixed. Each asserts chosen === gold.
 * Exact for mock and replay. Live answers vary slightly between runs, so the file says to use repeats.
 */
export function exportRegressions(o: RegressionOptions): ExportFile {
  const live = o.backend === "http";
  const cases = o.fixed
    .map(
      (f) =>
        `  it(${JSON.stringify(`${f.id}: ${f.query}`)}, async () => {\n` +
        `    const res = await backend.decide(buildRequest(criteria, ${JSON.stringify(f.query)}, MODEL));\n` +
        `    const d = res.decisions[${JSON.stringify(QUESTION_ID)}];\n` +
        `    expect(d?.kind === "choice" && d.chosen).toBe(${JSON.stringify(f.gold)});\n` +
        `  });`,
    )
    .join("\n\n");
  const content = `/**
 * Crosstalk regression tests, criteria ${o.version}. Generated ${new Date().toISOString()}.
 * One case per item that flipped from wrong to right when ${o.version} was saved (backend: ${o.backend}).
 * Place this file in crosstalk-lab/tests/unit/ and run \`npm test\`.
 *
 * ${
   live
     ? "Recorded against a LIVE backend. Answers vary slightly between runs: before relying on these cases, run each several times and assert on a tolerance (for example, gold wins in at least 4 of 5 runs)."
     : "Recorded against the deterministic lexical mock (MOCK · lexical stand-in, not Jev). The assertions are exact for mock and replay."
 }
 */
import { describe, expect, it } from "vitest";
import { createMockBackend } from "../../src/core/jev/mock-lexsim.ts";
import { buildRequest } from "../../src/core/run/request.ts";
import type { Criterion } from "../../src/core/jev/types.ts";

const MODEL = ${JSON.stringify(o.model)};
// Instructions sent with every request: ${JSON.stringify(INSTRUCTIONS)}
const criteria: Record<string, Criterion> = ${JSON.stringify(o.criteria, null, 2)};

const backend = createMockBackend();

describe("crosstalk regressions ${o.version}", () => {
${cases || "  it.todo(\"no items flipped to fixed in this version\");"}
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
