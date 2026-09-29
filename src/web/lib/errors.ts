/** Plain-language explanations for failed items. Never shows raw JSON. */
import type { ItemResult } from "../../core/run/runner.ts";

/** Short label for a failure code (badges, filters, the inspector). */
export function codeLabel(code: string): string {
  switch (code) {
    case "budget":
      return "spend cap reached";
    case "rate_limit":
      return "rate limit (429)";
    case "auth":
      return "API key rejected (401)";
    case "replay_miss":
      return "no cached response";
    case "timeout":
      return "timed out";
    case "aborted":
      return "cancelled";
    case "forbidden":
      return "refused by the local server";
    case "overloaded":
      return "upstream overloaded (529)";
    case "validation":
      return "request rejected (422)";
    case "schema":
      return "unexpected answer format";
    case "connection":
      return "connection failed";
    case "not_ready":
      return "server has no API key";
    default:
      return code;
  }
}

/** What the user can do about a failure code. */
function advice(code: string, n: number, total: number): string {
  const items = n === 1 ? "1 item" : `${n} items`;
  const of = total && total !== n ? `${n} of ${total} items` : items;
  switch (code) {
    case "budget":
      return `${of} were not sent: the spend cap on the local server is reached. Raise CROSSTALK_BUDGET_USD and restart \`npm run live\` (spend resets with each server process).`;
    case "rate_limit":
      return `${of} hit the API rate limit (429). Wait a minute, then retry the failed items.`;
    case "auth":
      return `${of} were refused: the API key was rejected (401). Check the key in .env, then restart \`npm run live\`.`;
    case "replay_miss":
      return `${of} have no cached response. REPLAY only holds answers for v0 and the demo edit; switch to MOCK to run this version.`;
    case "timeout":
      return `${of} timed out. Retry the failed items.`;
    case "forbidden":
      return `${of} were refused by the local server (origin or token check). Reload the page, then retry.`;
    case "not_ready":
      return `${of} were not sent: the local server has no API key.`;
    case "connection":
      return `${of} could not reach the local server. Is \`npm run live\` still running?`;
    case "schema":
      return `${of} came back in a format this app does not expect, so they are not scored.`;
    default:
      return `${of} failed (${codeLabel(code)}). Retry the failed items.`;
  }
}

export interface FailureSummary {
  failed: number;
  total: number;
  /** Codes by count, most frequent first. */
  codes: { code: string; n: number }[];
  sentence: string;
}

export function summarizeFailures(results: ItemResult[]): FailureSummary | null {
  const failed = results.filter((r) => r.error);
  if (!failed.length) return null;
  const counts = new Map<string, number>();
  for (const r of failed) counts.set(r.error!.code, (counts.get(r.error!.code) ?? 0) + 1);
  const codes = [...counts.entries()].map(([code, n]) => ({ code, n })).sort((a, b) => b.n - a.n || (a.code < b.code ? -1 : 1));
  const main = codes[0]!;
  const rest = codes.slice(1).map((c) => `${c.n} ${codeLabel(c.code)}`);
  const sentence = advice(main.code, main.n, codes.length === 1 ? results.length : 0) + (rest.length ? ` Also: ${rest.join(", ")}.` : "");
  return { failed: failed.length, total: results.length, codes, sentence };
}
