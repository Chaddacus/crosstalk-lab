/** Dev and test items. Pure TypeScript. */
import { z } from "zod";
import { NONE } from "./catalog.ts";

export const PERSONAS = [
  "support_agent",
  "telecom_admin",
  "developer",
  "billing_analyst",
  "cc_supervisor",
  "security_admin",
] as const;

export const ItemSchema = z.strictObject({
  id: z.string().regex(/^[dt]-\d{4}$/),
  query: z.string().min(3),
  gold: z.string().min(1),
  kind: z.enum(["match", "no_match"]),
  persona: z.enum(PERSONAS),
  family: z.string().min(1),
});
export type Item = z.infer<typeof ItemSchema>;

export function parseJsonl(text: string): Item[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line, i) => {
      try {
        return ItemSchema.parse(JSON.parse(line));
      } catch (e) {
        throw new Error(`line ${i + 1}: ${(e as Error).message}`);
      }
    });
}

export function isNoMatch(item: Pick<Item, "gold">): boolean {
  return item.gold === NONE;
}

/** Lowercase, strip punctuation, collapse whitespace. Used to find near-duplicate queries across splits. */
export function normalizeQuery(q: string): string {
  return q
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export interface SplitManifestEntry {
  file: string;
  sha256: string;
  count: number;
  match: number;
  noMatch: number;
  frozenAt: string;
}

export interface Manifest {
  dataset: string;
  spec: { sha256: string; commit: string };
  labelPolicy: { file: string; sha256: string };
  splits: { test?: SplitManifestEntry; dev?: SplitManifestEntry };
}
