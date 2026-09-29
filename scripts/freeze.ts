/**
 * Freeze a split: write its sha256 and counts into data/twilio-v2010/MANIFEST.json.
 *   npm run freeze -- --split test     (once, before criteria.v0.json, mock tuning or UI code)
 *   npm run freeze -- --split dev
 * Refuses to overwrite an existing entry unless --refreeze is passed (re-freezing test resets the seal).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { sha256Hex } from "../src/core/jev/canonical.ts";
import { type Manifest, parseJsonl } from "../src/core/data/splits.ts";
import { NONE } from "../src/core/data/catalog.ts";

const DIR = "data/twilio-v2010";
const split = process.argv[process.argv.indexOf("--split") + 1];
if (split !== "test" && split !== "dev") throw new Error("usage: freeze --split test|dev");
const refreeze = process.argv.includes("--refreeze");

const catalog = JSON.parse(readFileSync(`${DIR}/catalog.json`, "utf8"));
const manifestPath = `${DIR}/MANIFEST.json`;
const manifest: Manifest = existsSync(manifestPath)
  ? JSON.parse(readFileSync(manifestPath, "utf8"))
  : {
      dataset: "twilio-v2010",
      spec: { sha256: catalog.source.sha256, commit: catalog.source.commit },
      labelPolicy: { file: "LABEL_POLICY.md", sha256: "" },
      splits: {},
    };
if (manifest.splits[split] && !refreeze) {
  console.error(`${split} is already frozen (sha256 ${manifest.splits[split].sha256}). Pass --refreeze to replace it.`);
  process.exit(1);
}
manifest.labelPolicy.sha256 = await sha256Hex(readFileSync(`${DIR}/LABEL_POLICY.md`));
const bytes = readFileSync(`${DIR}/${split}.jsonl`);
const items = parseJsonl(bytes.toString("utf8"));
const noMatch = items.filter((i) => i.gold === NONE).length;
manifest.splits[split] = {
  file: `${split}.jsonl`,
  sha256: await sha256Hex(bytes),
  count: items.length,
  match: items.length - noMatch,
  noMatch,
  frozenAt: new Date().toISOString(),
};
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(`froze ${split}: ${items.length} items, sha256 ${manifest.splits[split].sha256}`);
