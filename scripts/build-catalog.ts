/** Build data/twilio-v2010/catalog.json from the pinned spec in .cache/spec/ (run fetch-spec first). */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { buildCatalog } from "../src/core/data/catalog.ts";
import { SPEC_LOCAL, SPEC_PIN } from "./_spec.ts";

const bytes = readFileSync(SPEC_LOCAL);
const sha = createHash("sha256").update(bytes).digest("hex");
if (sha !== SPEC_PIN.sha256) throw new Error(`spec sha256 ${sha} does not match the pin; run npm run fetch-spec`);
const spec = JSON.parse(bytes.toString("utf8"));
const catalog = buildCatalog(spec, { repo: SPEC_PIN.repo, file: SPEC_PIN.file, commit: SPEC_PIN.commit, sha256: SPEC_PIN.sha256 });
writeFileSync("data/twilio-v2010/catalog.json", JSON.stringify(catalog, null, 2) + "\n");
const m = (x: string) => catalog.operations.filter((o) => o.method === x).length;
console.log(
  `catalog: ${catalog.operations.length} ops, ${catalog.families.length} families, GET ${m("GET")} / POST ${m("POST")} / DELETE ${m("DELETE")}, ` +
    `${catalog.operations.filter((o) => o.empty).length} empty in spec`,
);
