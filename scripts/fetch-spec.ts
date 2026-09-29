/**
 * Download the Twilio v2010 spec at the pinned commit (or copy a local file with --from <path>)
 * into .cache/spec/, and refuse on a sha256 mismatch.
 *   npm run fetch-spec
 *   npm run fetch-spec -- --from path/to/twilio_api_v2010.json
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { SPEC_LOCAL, SPEC_PIN, SPEC_URL } from "./_spec.ts";

const fromIdx = process.argv.indexOf("--from");
let bytes: Buffer;
if (fromIdx > 0) {
  bytes = readFileSync(process.argv[fromIdx + 1]!);
  console.log(`read ${bytes.length} bytes from ${process.argv[fromIdx + 1]}`);
} else {
  console.log(`fetching ${SPEC_URL}`);
  const res = await fetch(SPEC_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching spec`);
  bytes = Buffer.from(await res.arrayBuffer());
}
const sha = createHash("sha256").update(bytes).digest("hex");
if (sha !== SPEC_PIN.sha256) {
  console.error(`sha256 mismatch: got ${sha}, pinned ${SPEC_PIN.sha256}. Refusing.`);
  process.exit(1);
}
mkdirSync(dirname(SPEC_LOCAL), { recursive: true });
writeFileSync(SPEC_LOCAL, bytes);
console.log(`ok: sha256 ${sha} (${bytes.length} bytes) -> ${SPEC_LOCAL}`);
