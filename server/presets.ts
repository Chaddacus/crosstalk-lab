/**
 * Backend presets for the local server and the CLI (Node only). Keys come from the environment
 * and are never logged, returned, or written to disk.
 *
 * | preset     | base URL                   | key env             | default model        |
 * |------------|----------------------------|---------------------|----------------------|
 * | typesafe   | https://api.typesafe.ai    | TYPESAFE_API_KEY    | jev-1.13.0 (pinned)  |
 * | openrouter | https://openrouter.ai/api  | OPENROUTER_API_KEY  | typesafe/jev-1.13    |
 * | compat     | CROSSTALK_COMPAT_URL       | CROSSTALK_COMPAT_KEY (optional) | CROSSTALK_MODEL (required) |
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

export type PresetName = "typesafe" | "openrouter" | "compat";

export interface Preset {
  name: PresetName;
  baseUrl: string;
  apiKey: string | undefined;
  model: string;
  keyEnv: string;
}

/** Load KEY=VALUE lines from .env into process.env (without overriding existing values). No dependency. */
export function loadDotEnv(path = ".env"): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trimStart().startsWith("#")) continue;
    const [, k, raw] = m;
    const v = raw!.replace(/^["']|["']$/g, "");
    if (process.env[k!] === undefined && v !== "") process.env[k!] = v;
  }
}

export function resolvePreset(env: NodeJS.ProcessEnv = process.env): Preset {
  const name = (env.CROSSTALK_PRESET || "typesafe") as PresetName;
  const override = env.CROSSTALK_MODEL?.trim() || undefined;
  switch (name) {
    case "typesafe":
      return { name, baseUrl: "https://api.typesafe.ai", apiKey: env.TYPESAFE_API_KEY || undefined, model: override ?? "jev-1.13.0", keyEnv: "TYPESAFE_API_KEY" };
    case "openrouter":
      return { name, baseUrl: "https://openrouter.ai/api", apiKey: env.OPENROUTER_API_KEY || undefined, model: override ?? "typesafe/jev-1.13", keyEnv: "OPENROUTER_API_KEY" };
    case "compat": {
      const baseUrl = env.CROSSTALK_COMPAT_URL?.trim();
      if (!baseUrl) throw new Error("CROSSTALK_PRESET=compat needs CROSSTALK_COMPAT_URL (for example http://127.0.0.1:8000)");
      if (!override) throw new Error("CROSSTALK_PRESET=compat needs CROSSTALK_MODEL (for example kev-latest)");
      return { name, baseUrl, apiKey: env.CROSSTALK_COMPAT_KEY || undefined, model: override, keyEnv: "CROSSTALK_COMPAT_KEY" };
    }
    default:
      throw new Error(`unknown CROSSTALK_PRESET ${name as string} (use typesafe, openrouter or compat)`);
  }
}

/** True when the preset can make calls (compat may run without a key). */
export function presetReady(p: Preset): boolean {
  return p.name === "compat" || !!p.apiKey;
}

/** Base URL without trailing slashes, lowercased scheme and host: the upstream's identity for the cache. */
export function normalizeBaseUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, "")}`.toLowerCase();
  } catch {
    return url.replace(/\/+$/, "").toLowerCase();
  }
}

/**
 * Cache namespace for one upstream: preset name plus a short hash of the normalized base URL.
 * Answers from a fake or compat server can never be served as, or mixed with, answers from TypeSafe.
 */
export function cacheNamespace(p: Pick<Preset, "name" | "baseUrl">): string {
  return `${p.name}-${createHash("sha256").update(normalizeBaseUrl(p.baseUrl)).digest("hex").slice(0, 12)}`;
}
