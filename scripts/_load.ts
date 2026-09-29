/** Shared loaders for the CLI scripts (Node only). */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Catalog } from "../src/core/data/catalog.ts";
import { type Item, type Manifest, parseJsonl } from "../src/core/data/splits.ts";
import type { Criterion } from "../src/core/jev/types.ts";
import { fixtureStore, type ReplayFixture, type ReplayStore } from "../src/core/jev/replay.ts";
import { type Preset, cacheNamespace, normalizeBaseUrl } from "../server/presets.ts";

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

/**
 * Replay sources: public mock fixtures, plus (when a preset is given) the local cache of real responses that the
 * live server wrote for that upstream (never committed). Entries written for another upstream are never read.
 */
export function loadReplayStore(preset?: Pick<Preset, "name" | "baseUrl">, cacheRoot = ".cache/responses"): ReplayStore {
  const fixtures: ReplayFixture[] = [];
  if (existsSync("fixtures/replay"))
    for (const f of readdirSync("fixtures/replay"))
      if (f.endsWith(".json")) fixtures.push(JSON.parse(readFileSync(join("fixtures/replay", f), "utf8")));
  const cached = new Map<string, unknown>();
  if (preset) {
    const dir = join(cacheRoot, cacheNamespace(preset));
    const baseUrl = normalizeBaseUrl(preset.baseUrl);
    if (existsSync(dir))
      for (const f of readdirSync(dir)) {
        if (!/^[0-9a-f]{64}\.json$/.test(f)) continue;
        const e = JSON.parse(readFileSync(join(dir, f), "utf8")) as { kind?: string; origin?: { preset?: string; baseUrl?: string }; response?: unknown };
        if (e.kind === "crosstalk-live-cache" && e.origin?.preset === preset.name && e.origin.baseUrl === baseUrl) cached.set(f.slice(0, 64), e.response);
      }
  }
  return fixtureStore(fixtures, cached);
}
