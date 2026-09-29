/**
 * Grid search for the lexical mock parameters (β, T) on the DEV split only, with criteria.v0.json.
 * Goal: a readable map (a spread of confidences, real confusions, no-match neither ignored nor dominant),
 * not calibration and not maximum accuracy. Prints a table; the chosen values are recorded in mock-lexsim.ts.
 */
import { createMockBackend, DEFAULT_MOCK_PARAMS } from "../src/core/jev/mock-lexsim.ts";
import { runItems } from "../src/core/run/runner.ts";
import { accuracy, reliability, scoreRun } from "../src/core/eval/metrics.ts";
import { computeLeakage } from "../src/core/eval/leakage.ts";
import { loadCriteria, loadDev } from "./_load.ts";

const dev = loadDev();
const criteria = loadCriteria();
const rows: string[] = [];
for (const beta of [2, 3, 4, 5, 6]) {
  for (const temperature of [0.5, 0.75, 1, 1.5, 2]) {
    const p = { ...DEFAULT_MOCK_PARAMS, beta, temperature };
    const run = await runItems({ backend: createMockBackend(p), items: dev, criteria, criteriaHash: "tune", model: "mock", split: "dev" });
    const s = scoreRun(dev, run);
    const a = accuracy(s);
    const leak = computeLeakage(dev, run);
    const errPairs = leak.pairs.filter((x) => x.state === "error");
    const opPairs = errPairs.filter((x) => !x.hub).length;
    const meanTop = s.reduce((q, x) => q + x.pTop, 0) / s.length;
    rows.push(
      `β=${beta} T=${temperature}  acc ${(a.all.p * 100).toFixed(1)}  match ${(a.match.p * 100).toFixed(1)}  nomatch ${(a.noMatch.p * 100).toFixed(1)}  ` +
        `meanPtop ${meanTop.toFixed(2)}  ECE ${reliability(s).ece.toFixed(3)}  errPairs ${errPairs.length} (op-op ${opPairs})`,
    );
  }
}
console.log(rows.join("\n"));
