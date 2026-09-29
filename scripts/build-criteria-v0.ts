/** Write data/twilio-v2010/criteria.v0.json: the Choice criteria map derived from the spec only. */
import { readFileSync, writeFileSync } from "node:fs";
import { textsFromSpec, toChoiceCriteria } from "../src/core/data/criteria.ts";
import type { Catalog } from "../src/core/data/catalog.ts";

const catalog: Catalog = JSON.parse(readFileSync("data/twilio-v2010/catalog.json", "utf8"));
const criteria = toChoiceCriteria(catalog.operations, textsFromSpec(catalog.operations));
writeFileSync("data/twilio-v2010/criteria.v0.json", JSON.stringify(criteria, null, 2) + "\n");
const chars = JSON.stringify(criteria).length;
console.log(`criteria.v0.json: ${Object.keys(criteria).length} options, ${chars} characters (about ${Math.round(chars / 4)} tokens at 4 chars/token, estimate)`);
