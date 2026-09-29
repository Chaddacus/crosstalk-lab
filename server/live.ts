/**
 * Local live server (Hono). Holds the key, applies the limiter and the budget, caches responses, forwards requests.
 *   GET  /api/health      -> { live, preset, model, budgetUsd, spentUsd, token }   (never the key)
 *   POST /api/systemone   -> the upstream /v1/systemone response, validated both ways
 *
 * It spends money, so it only answers the local app:
 *  - Host must be 127.0.0.1:<port>, localhost:<port> or [::1]:<port> (blocks DNS rebinding);
 *  - an Origin header, when present, must be an allowed web origin (default: the Vite dev server) or the server
 *    itself; "null" and any other site are refused;
 *  - POST needs Content-Type: application/json (a cross-site "simple" text/plain POST is refused) and the
 *    per-process token from /api/health in `x-crosstalk-token` (a cross-site page cannot read it).
 * Every refusal happens before the budget or the upstream is touched.
 *
 * Real responses are cached in .cache/responses/<preset>-<base URL hash>/<request sha256>.json (gitignored), with
 * the upstream's identity stored in each entry and checked on read. They stay on this machine.
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { createHttpBackend } from "../src/core/jev/http.ts";
import { WireRequestSchema, fromWireBilled, validateRequest } from "../src/core/jev/wire.ts";
import { hashJson } from "../src/core/jev/canonical.ts";
import {
  AbortedError,
  AuthError,
  BudgetExceeded,
  CrosstalkError,
  RateLimitError,
  RequestError,
  TimeoutError,
  ValidationError,
  redact,
} from "../src/core/jev/errors.ts";
import type { DecideRequest } from "../src/core/jev/types.ts";
import { Budget } from "../src/core/run/budget.ts";
import { createLimiter } from "../src/core/run/limiter.ts";
import { guarded } from "../src/core/run/guarded.ts";
import { type Preset, cacheNamespace, normalizeBaseUrl, presetReady } from "./presets.ts";

export const DEFAULT_WEB_ORIGINS = ["http://127.0.0.1:5173", "http://localhost:5173"];
export const TOKEN_HEADER = "x-crosstalk-token";
/** Send `x-crosstalk-cache: bypass` to skip the cache read (a fresh, paid call; the answer is still cached). */
export const CACHE_HEADER = "x-crosstalk-cache";

export interface LiveAppOptions {
  preset: Preset;
  budgetUsd: number;
  /** Port the server listens on; used for the Host check. Default 8787. */
  port?: number;
  /** Web origins allowed to call the API (the Vite dev server). */
  allowedOrigins?: string[];
  /** Root of the response cache. Default .cache/responses. */
  cacheDir?: string;
  /** Total time for one upstream call, retries included. Must stay under the browser's 60 s. Default 45 s. */
  deadlineMs?: number;
  /** Fixed token (tests). Default: 32 random bytes per process. */
  token?: string;
  fetch?: typeof fetch;
  log?: (line: string) => void;
  requestsPerMinute?: number;
  concurrency?: number;
  sleep?: (ms: number) => Promise<void>;
}

interface CacheEntry {
  kind: "crosstalk-live-cache";
  origin: { preset: string; baseUrl: string; model: string };
  savedAt: string;
  response: unknown;
}

export function createLiveApp(o: LiveAppOptions) {
  const app = new Hono();
  const port = o.port ?? 8787;
  const origin = { preset: o.preset.name, baseUrl: normalizeBaseUrl(o.preset.baseUrl) };
  const cacheDir = join(o.cacheDir ?? ".cache/responses", cacheNamespace(o.preset));
  const token = o.token ?? randomBytes(32).toString("hex");
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
  const allowedOrigins = new Set([...(o.allowedOrigins ?? DEFAULT_WEB_ORIGINS), `http://127.0.0.1:${port}`, `http://localhost:${port}`]);
  const budget = new Budget(o.budgetUsd);
  const limiter = createLimiter({ requestsPerMinute: o.requestsPerMinute ?? 600, concurrency: o.concurrency ?? 8 });
  const log = (line: string) => (o.log ?? console.log)(redact(line, [o.preset.apiKey, token]));
  const http = createHttpBackend({
    baseUrl: o.preset.baseUrl,
    apiKey: o.preset.apiKey,
    label: `${o.preset.model} · live`,
    fetch: o.fetch,
    sleep: o.sleep,
    deadlineMs: o.deadlineMs ?? 45_000,
    logger: (level, m) => level !== "debug" && log(`[${level}] ${m}`),
  });
  const ready = presetReady(o.preset);

  // Host and Origin checks for every API route, before anything else runs.
  app.use("/api/*", async (c, next) => {
    const host = (c.req.header("host") ?? "").toLowerCase();
    if (!allowedHosts.has(host)) {
      log(`refused ${c.req.method} ${c.req.path}: host ${JSON.stringify(host).slice(0, 80)} is not allowed`);
      return c.json({ error: "host not allowed: this server only answers on 127.0.0.1", code: "forbidden" }, 403);
    }
    const reqOrigin = c.req.header("origin");
    if (reqOrigin !== undefined && !allowedOrigins.has(reqOrigin)) {
      log(`refused ${c.req.method} ${c.req.path}: origin ${JSON.stringify(reqOrigin).slice(0, 80)} is not allowed`);
      return c.json({ error: "origin not allowed", code: "forbidden" }, 403);
    }
    await next();
  });

  app.get("/api/health", (c) =>
    c.json(
      ready
        ? { live: true, preset: o.preset.name, model: o.preset.model, budgetUsd: budget.capUsd, spentUsd: budget.spentUsd, reservedUsd: budget.reservedUsd, token }
        : { live: false, preset: o.preset.name, reason: `${o.preset.keyEnv} is not set` },
    ),
  );

  app.post("/api/systemone", async (c) => {
    if (!/^application\/json\b/i.test(c.req.header("content-type") ?? "")) return c.json({ error: "Content-Type must be application/json", code: "forbidden" }, 415);
    if (!ready) return c.json({ error: `${o.preset.keyEnv} is not set on the server`, code: "not_ready" }, 503);
    if (c.req.header(TOKEN_HEADER) !== token) return c.json({ error: `missing or wrong ${TOKEN_HEADER} (read it from /api/health)`, code: "forbidden" }, 403);
    let raw: unknown;
    try {
      raw = JSON.parse(await c.req.text());
    } catch {
      return c.json({ error: "body must be JSON", code: "request" }, 400);
    }
    const parsed = WireRequestSchema.safeParse(raw);
    if (!parsed.success) return c.json({ error: "request does not match the /v1/systemone schema", code: "request", issues: parsed.error.issues.slice(0, 5) }, 422);
    const body = parsed.data;
    try {
      // The documented limits (≤ 255 Choice options, Score 2..10 levels, at least one question) are checked
      // here, before any budget is reserved or any byte goes upstream.
      validateRequest(body as unknown as DecideRequest);
    } catch (e) {
      if (e instanceof RequestError) return c.json({ error: e.message, code: "request" }, 422);
      throw e;
    }
    if (body.model !== o.preset.model) return c.json({ error: `model mismatch: this server is pinned to ${o.preset.model}`, code: "model" }, 400);
    const hash = await hashJson({ model: body.model, state: body.state, questions: body.questions });
    const file = join(cacheDir, `${hash}.json`);
    const t0 = Date.now();
    if (c.req.header(CACHE_HEADER) !== "bypass" && existsSync(file)) {
      const hit = readCache(file, { ...origin, model: body.model });
      if (hit !== undefined) {
        c.header(CACHE_HEADER, "hit");
        log(`POST /api/systemone ${hash.slice(0, 12)} cache hit`);
        return c.json(hit as Record<string, unknown>);
      }
    }
    const signal = c.req.raw.signal;
    try {
      const json = await guarded(
        JSON.stringify(body).length,
        limiter,
        budget,
        async () => {
          const r = await http.sendWire(body, { signal });
          const res = fromWireBilled(r.json, body as unknown as DecideRequest, { backend: "http", requestHash: hash, wallMs: r.wallMs, cached: false, retries: r.retries });
          return { value: r.json, costUsd: res.usage.costUsd ?? 0, inputTokens: res.usage.inputTokens, estimated: res.usage.costSource === "estimated" };
        },
        signal,
      );
      mkdirSync(cacheDir, { recursive: true });
      const entry: CacheEntry = { kind: "crosstalk-live-cache", origin: { ...origin, model: body.model }, savedAt: new Date().toISOString(), response: json };
      writeFileSync(file, JSON.stringify(entry));
      c.header(CACHE_HEADER, "miss");
      log(`POST /api/systemone ${hash.slice(0, 12)} 200 ${Date.now() - t0} ms · spent $${budget.spentUsd.toFixed(5)} of $${budget.capUsd.toFixed(2)}`);
      return c.json(json as Record<string, unknown>);
    } catch (e) {
      const err = e as CrosstalkError;
      const status =
        e instanceof BudgetExceeded ? 402
        : e instanceof AuthError ? 401
        : e instanceof ValidationError ? 422
        : e instanceof RateLimitError ? 429
        : e instanceof TimeoutError ? 504
        : e instanceof AbortedError ? 499
        : 502;
      log(`POST /api/systemone ${hash.slice(0, 12)} ${status} ${err.code ?? "error"}: ${err.message}`);
      return c.json(
        { error: redact(err.message ?? String(e), [o.preset.apiKey, token]), code: err.code ?? "error", ...(e instanceof ValidationError ? { upstream: e.body } : {}) },
        status as 402,
      );
    }
  });

  return { app, budget, token, cacheDir };
}

/** Read one cache entry; undefined when missing, unreadable, or written for a different upstream or model. */
export function readCache(file: string, expect: CacheEntry["origin"]): unknown | undefined {
  try {
    const e = JSON.parse(readFileSync(file, "utf8")) as Partial<CacheEntry>;
    if (e.kind !== "crosstalk-live-cache" || !e.origin) return undefined;
    if (e.origin.preset !== expect.preset || e.origin.baseUrl !== expect.baseUrl || e.origin.model !== expect.model) return undefined;
    return e.response;
  } catch {
    return undefined;
  }
}
