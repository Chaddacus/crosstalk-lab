/**
 * The sealed test split and the peek ledger.
 *
 * "Sealed" means the test file's sha256 was committed before any tuning, and every run on it is counted.
 * It is not secrecy: anyone can read the file.
 */
import { SealError } from "../jev/errors.ts";
import { sha256Hex } from "../jev/canonical.ts";
import { type Item, type Manifest, parseJsonl } from "../data/splits.ts";

export interface LedgerRow {
  peek: number;
  at: string;
  split: "test";
  testSha256: string;
  criteriaHash: string;
  criteriaVersion?: string;
  backend: string;
  model: string;
  n: number;
  accuracy: number;
  lo: number;
  hi: number;
  matchAccuracy: number;
  noMatchAccuracy: number;
  riskPer100: number;
  errors: number;
  where: "browser" | "cli";
}

export interface LedgerStore {
  read(): Promise<LedgerRow[]>;
  append(row: LedgerRow): Promise<void>;
}

export interface LoadSealedOptions {
  /** Must be true. Loading the test split without it throws. */
  unseal: boolean;
  manifest: Manifest;
  read: () => Promise<Uint8Array | ArrayBuffer | string>;
}

export async function loadSealedSplit(o: LoadSealedOptions): Promise<{ items: Item[]; sha256: string }> {
  if (!o.unseal) throw new SealError("the test split is sealed; pass the unseal flag to run it (this records one peek)");
  const expected = o.manifest.splits.test?.sha256;
  if (!expected) throw new SealError("MANIFEST.json has no test entry");
  const raw = await o.read();
  const bytes = typeof raw === "string" ? new TextEncoder().encode(raw) : raw instanceof Uint8Array ? raw : new Uint8Array(raw);
  const sha = await sha256Hex(bytes);
  if (sha !== expected) throw new SealError(`test split hash mismatch: file ${sha.slice(0, 12)}…, manifest ${expected.slice(0, 12)}…. Refusing to run.`);
  const items = parseJsonl(new TextDecoder().decode(bytes));
  if (items.length !== o.manifest.splits.test!.count) throw new SealError(`test split has ${items.length} items, manifest says ${o.manifest.splits.test!.count}`);
  return { items, sha256: sha };
}

/** Append one peek. The peek number is the row count after appending. */
export async function recordPeek(store: LedgerStore, row: Omit<LedgerRow, "peek">): Promise<LedgerRow> {
  const rows = await store.read();
  const full: LedgerRow = { ...row, peek: rows.length + 1 };
  await store.append(full);
  return full;
}

export function memoryLedger(initial: LedgerRow[] = []): LedgerStore {
  const rows = [...initial];
  return {
    read: async () => [...rows],
    append: async (r) => {
      rows.push(r);
    },
  };
}

export function parseLedger(text: string): LedgerRow[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as LedgerRow);
}
