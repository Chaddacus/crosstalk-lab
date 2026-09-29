/**
 * Catalog: the 197 operations of the pinned Twilio Voice/REST API v2010 spec, as options for one Choice.
 * Pure TypeScript (no DOM, no Node APIs), shared by the browser, worker, CLI and tests.
 */

export type HttpMethod = "GET" | "POST" | "DELETE" | "PUT" | "PATCH";

export interface Operation {
  /** operationId from the spec; also the Choice option name. */
  id: string;
  method: HttpMethod;
  /** Full path as written in the spec. */
  path: string;
  /** Path without the `/2010-04-01/Accounts/{AccountSid}` (or `/2010-04-01`) prefix and without `.json`. */
  shortPath: string;
  /** First literal path segment after the account prefix. Account-level operations go to `Accounts`. */
  family: string;
  /** First spec tag (shown in the tooltip only; too fine for the ring). */
  tag: string;
  /** Spec `description`, falling back to `summary`. Empty string when the spec has neither. */
  description: string;
  /** True when the spec has no description and no summary for this operation. */
  empty: boolean;
}

export interface Catalog {
  source: { repo: string; file: string; commit: string; sha256: string };
  apiTitle: string;
  operations: Operation[];
  families: { name: string; count: number }[];
}

export const NONE = "none_of_these" as const;

const ACCOUNT_PREFIX = "/2010-04-01/Accounts/{AccountSid}";
const VERSION_PREFIX = "/2010-04-01";
const METHODS = ["get", "post", "delete", "put", "patch"] as const;

export function shortPathOf(path: string): string {
  let p = path;
  if (p.startsWith(ACCOUNT_PREFIX + "/")) p = p.slice(ACCOUNT_PREFIX.length);
  else if (p.startsWith(VERSION_PREFIX)) p = p.slice(VERSION_PREFIX.length);
  if (p.endsWith(".json")) p = p.slice(0, -".json".length);
  return p;
}

export function familyOf(path: string): string {
  if (!path.startsWith(ACCOUNT_PREFIX + "/")) return "Accounts";
  const rest = path.slice(ACCOUNT_PREFIX.length + 1);
  return rest.split("/")[0]!.replace(/\.json$/, "");
}

interface SpecOperation {
  operationId?: string;
  description?: string;
  summary?: string;
  tags?: string[];
}

/** Build the catalog from a parsed OpenAPI document. Order: family by first appearance, then spec order. */
export function buildCatalog(
  spec: { info?: { title?: string }; paths: Record<string, Record<string, unknown>> },
  source: Catalog["source"],
): Catalog {
  const flat: Operation[] = [];
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const key of Object.keys(item)) {
      if (!(METHODS as readonly string[]).includes(key)) continue;
      const op = item[key] as SpecOperation;
      if (!op.operationId) throw new Error(`operation without operationId at ${key.toUpperCase()} ${path}`);
      const description = (op.description ?? "").trim() || (op.summary ?? "").trim();
      flat.push({
        id: op.operationId,
        method: key.toUpperCase() as HttpMethod,
        path,
        shortPath: shortPathOf(path),
        family: familyOf(path),
        tag: op.tags?.[0] ?? "",
        description,
        empty: description.length === 0,
      });
    }
  }
  const ids = new Set<string>();
  for (const o of flat) {
    if (ids.has(o.id)) throw new Error(`duplicate operationId ${o.id}`);
    if (o.id === NONE) throw new Error(`operationId collides with ${NONE}`);
    ids.add(o.id);
  }
  const familyOrder: string[] = [];
  for (const o of flat) if (!familyOrder.includes(o.family)) familyOrder.push(o.family);
  const operations = familyOrder.flatMap((f) => flat.filter((o) => o.family === f));
  if (operations.length >= 255) throw new Error(`${operations.length} operations plus ${NONE} exceed the 255-option Choice limit`);
  return {
    source,
    apiTitle: spec.info?.title ?? "",
    operations,
    families: familyOrder.map((name) => ({ name, count: operations.filter((o) => o.family === name).length })),
  };
}
