/** Shared loaders for the CLI scripts (Node only). */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Catalog } from "../src/core/data/catalog.ts";
import { type Item, type Manifest, parseJsonl } from "../src/core/data/splits.ts";
import type { Criterion } from "../src/core/jev/types.ts";
import type { ReplayFixture } from "../src/core/jev/replay.ts";

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

/** Replay sources: public mock fixtures plus the local .cache of real responses (never committed). */
export function loadReplayResponses(dirs = ["fixtures/replay", ".cache/responses"]): Map<string, unknown> {
  const m = new Map<string, unknown>();
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".json")) continue;
      const j = JSON.parse(readFileSync(join(dir, f), "utf8"));
      if ((j as ReplayFixture).kind === "crosstalk-replay-fixture") for (const [k, v] of Object.entries((j as ReplayFixture).responses)) m.set(k, v);
      else if (/^[0-9a-f]{64}\.json$/.test(f)) m.set(f.slice(0, 64), j);
    }
  }
  return m;
}
