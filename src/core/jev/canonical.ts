/**
 * Canonical JSON and hashing. Pure TypeScript; uses Web Crypto (`crypto.subtle`), which exists in
 * browsers, Web Workers and Node 24.
 *
 * Canonical JSON rules:
 *  - object keys sorted by UTF-16 code unit order (Array.prototype.sort default) at every level
 *  - no whitespace
 *  - numbers use the JavaScript default formatting (JSON.stringify)
 *  - `undefined` object members are dropped (as JSON.stringify does); arrays keep their order
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const s = JSON.stringify(value);
    if (s === undefined) throw new TypeError("canonicalJson: value is not JSON-serializable");
    return s;
  }
  if (Array.isArray(value)) {
    return "[" + value.map((v) => (v === undefined ? "null" : canonicalJson(v))).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(obj[k])).join(",") + "}";
}

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));

export async function sha256Hex(data: string | Uint8Array | ArrayBuffer): Promise<string> {
  const bytes =
    typeof data === "string" ? new TextEncoder().encode(data) : data instanceof Uint8Array ? data : new Uint8Array(data);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>));
  let out = "";
  for (const b of digest) out += HEX[b];
  return out;
}

/** sha256 of the canonical JSON of a value. */
export function hashJson(value: unknown): Promise<string> {
  return sha256Hex(canonicalJson(value));
}
