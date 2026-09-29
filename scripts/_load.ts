/** Shared loaders for the CLI scripts (Node only). */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Catalog } from "../src/core/data/catalog.ts";
import { type Item, type Manifest, parseJsonl } from "../src/core/data/splits.ts";
import type { Criterion } from "../src/core/jev/types.ts";
import { fixtureStore, type ReplayFixture, type ReplayStore } from "../src/core/jev/replay.ts";

export const DATA = "data/twilio-v2010";

export function loadCatalog(): Catalog {
  return JSON.parse(readFileSync(`${DATA}/catalog.json`, "utf8"));
}
export function loadManifest(): Manifest {
  return JSON.parse(readFileSync(`${DATA}/MANIFEST.json`, "utf8"));
}
export function loadDev(): Item[] {
  return parseJsonl(readFileSync(`${DATA}/dev.jsonl`, "utf8"));
}
export function loadCriteria(file = `${DATA}/criteria.v0.json`): Record<string, Criterion> {
  return JSON.parse(readFileSync(file, "utf8"));
}

/** Replay sources: public mock fixtures, plus the local .cache of real responses (never committed). */
export function loadReplayStore(): ReplayStore {
  const fixtures: ReplayFixture[] = [];
  if (existsSync("fixtures/replay"))
    for (const f of readdirSync("fixtures/replay"))
      if (f.endsWith(".json")) fixtures.push(JSON.parse(readFileSync(join("fixtures/replay", f), "utf8")));
  const cached = new Map<string, unknown>();
  const dir = ".cache/responses";
  if (existsSync(dir))
    for (const f of readdirSync(dir)) if (/^[0-9a-f]{64}\.json$/.test(f)) cached.set(f.slice(0, 64), JSON.parse(readFileSync(join(dir, f), "utf8")));
  return fixtureStore(fixtures, cached);
}
