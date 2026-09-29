/** Lint the dev and test splits. Exit 1 on errors. Prints the spec-echo rate. */
import { existsSync, readFileSync } from "node:fs";
import { type Item, parseJsonl } from "../src/core/data/splits.ts";
import { crossSplitOverlap, lintSplit } from "../src/core/data/lint.ts";

const DIR = "data/twilio-v2010";
const ops = JSON.parse(readFileSync(`${DIR}/catalog.json`, "utf8")).operations;
let failed = false;
const loaded: Record<string, Item[]> = {};
for (const split of ["dev", "test"] as const) {
  if (!existsSync(`${DIR}/${split}.jsonl`)) continue;
  const items = parseJsonl(readFileSync(`${DIR}/${split}.jsonl`, "utf8"));
  loaded[split] = items;
  const r = lintSplit(ops, items);
  console.log(
    `${split}: ${r.stats.items} items, no-match ${(r.stats.noMatchShare * 100).toFixed(1)}%, ${r.stats.distinctOps} distinct ops, ` +
      `spec-echo ${(r.stats.specEchoRate * 100).toFixed(1)}% (${r.stats.specEchoItems.length} match items)`,
  );
  for (const w of r.warnings) console.log(`  warn: ${w}`);
  for (const e of r.errors) console.log(`  ERROR: ${e}`);
  if (r.errors.length) failed = true;
}
if (loaded.dev && loaded.test) {
  const o = crossSplitOverlap(loaded.dev, loaded.test);
  for (const e of o) console.log(`  ERROR overlap: ${e}`);
  if (o.length) failed = true;
}
process.exit(failed ? 1 : 0);
