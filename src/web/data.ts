/**
 * Static data bundled with the app. The sealed test split is NOT imported here: only its URL is,
 * and it is fetched when (and only when) the user unseals it.
 */
import catalogJson from "../../data/twilio-v2010/catalog.json";
import criteriaV0Json from "../../data/twilio-v2010/criteria.v0.json";
import manifestJson from "../../data/twilio-v2010/MANIFEST.json";
import devText from "../../data/twilio-v2010/dev.jsonl?raw";
import cliLedgerText from "../../ledger/test_runs.jsonl?raw";
import testUrl from "../../data/twilio-v2010/test.jsonl?url";
import type { Catalog, Operation } from "../core/data/catalog.ts";
import { parseJsonl, type Manifest } from "../core/data/splits.ts";
import type { Criterion } from "../core/jev/types.ts";
import { parseLedger } from "../core/eval/seal.ts";

export const catalog = catalogJson as Catalog;
export const ops: Operation[] = catalog.operations;
export const opsById = new Map(ops.map((o) => [o.id, o]));
export const deleteOps = new Set(ops.filter((o) => o.method === "DELETE").map((o) => o.id));
export const criteriaV0 = criteriaV0Json as Record<string, Criterion>;
export const manifest = manifestJson as Manifest;
export const devItems = parseJsonl(devText);
export const devById = new Map(devItems.map((i) => [i.id, i]));
export const TEST_URL = testUrl;
export const cliLedgerRows = parseLedger(cliLedgerText);
export const SPEC_SHORT = catalog.source.sha256.slice(0, 8);
export const TEST_SHA_SHORT = manifest.splits.test!.sha256.slice(0, 8);

/** Replay fixtures are loaded lazily, only when REPLAY is selected. */
export const replayFixtureUrls = import.meta.glob("../../fixtures/replay/*.json", { query: "?url", import: "default" }) as Record<
  string,
  () => Promise<string>
>;
