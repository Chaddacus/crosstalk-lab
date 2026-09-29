/**
 * CLI exports.
 *   npm run export -- --criteria data/twilio-v2010/criteria.v0.json --version v0
 *       -> exports/criteria.twilio-v2010.v0.json (validated against the wire schema)
 *   npm run export -- --criteria my-criteria.json --version v1 --before runs/a.json --after runs/b.json
 *       -> also exports/regressions.v1.test.ts with one case per item that flipped to fixed
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { exportCriteria, exportRegressions } from "../src/core/eval/export.ts";
import { scoreRun } from "../src/core/eval/metrics.ts";
import { diffRuns } from "../src/core/eval/diff.ts";
import type { RunRecord } from "../src/core/run/runner.ts";
import { loadCriteria, loadDev } from "./_load.ts";

const args = process.argv.slice(2);
const opt = (n: string, d?: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const version = opt("version", "v0")!;
const criteria = loadCriteria(opt("criteria"));
const model = opt("model", "jev-1.13.0")!;
mkdirSync("exports", { recursive: true });
const c = exportCriteria(criteria, version, model);
writeFileSync(`exports/${c.filename}`, c.content);
console.log(`wrote exports/${c.filename} (${Object.keys(criteria).length} options, valid wire criteria)`);

const beforePath = opt("before");
const afterPath = opt("after");
if (beforePath && afterPath) {
  const dev = loadDev();
  const before = JSON.parse(readFileSync(beforePath, "utf8")) as RunRecord;
  const after = JSON.parse(readFileSync(afterPath, "utf8")) as RunRecord;
  const d = diffRuns(scoreRun(dev, before), scoreRun(dev, after));
  const fixed = d.flipped.filter((f) => f.status === "fixed").map((f) => ({ id: f.id, query: f.query, gold: f.gold }));
  const r = exportRegressions({ version, criteria, fixed, backend: after.backend, model: after.model });
  writeFileSync(`exports/${r.filename}`, r.content);
  console.log(`wrote exports/${r.filename} (${fixed.length} cases; fixed ${d.fixed}, broke ${d.broke}, unchanged ${d.unchanged})`);
}
