/**
 * Local live server (Hono). Holds the key, applies the limiter and the budget, caches responses, forwards requests.
 *   GET  /api/health      -> { live, preset, model, budgetUsd, spentUsd }   (never the key)
 *   POST /api/systemone   -> the upstream /v1/systemone response, validated both ways
 * Real responses are cached in .cache/responses/<request sha256>.json (gitignored). They stay on this machine.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { createHttpBackend } from "../src/core/jev/http.ts";
import { WireRequestSchema, fromWire } from "../src/core/jev/wire.ts";
import { hashJson } from "../src/core/jev/canonical.ts";
import { AuthError, BudgetExceeded, CrosstalkError, RateLimitError, ValidationError, redact } from "../src/core/jev/errors.ts";
import type { DecideRequest } from "../src/core/jev/types.ts";
import { Budget } from "../src/core/run/budget.ts";
import { createLimiter } from "../src/core/run/limiter.ts";
import { guarded } from "../src/core/run/guarded.ts";
import { type Preset, presetReady } from "./presets.ts";

export interface LiveAppOptions {
  preset: Preset;
  budgetUsd: number;
  cacheDir?: string;
  fetch?: typeof fetch;
  log?: (line: string) => void;
  requestsPerMinute?: number;
  concurrency?: number;
  sleep?: (ms: number) => Promise<void>;
}

export function createLiveApp(o: LiveAppOptions) {
  const app = new Hono();
  const cacheDir = o.cacheDir ?? ".cache/responses";
  const budget = new Budget(o.budgetUsd);
  const limiter = createLimiter({ requestsPerMinute: o.requestsPerMinute ?? 600, concurrency: o.concurrency ?? 8 });
  const log = (line: string) => (o.log ?? console.log)(redact(line, [o.preset.apiKey]));
  const http = createHttpBackend({
    baseUrl: o.preset.baseUrl,
    apiKey: o.preset.apiKey,
    label: `${o.preset.model} · live`,
    fetch: o.fetch,
    sleep: o.sleep,
    logger: (level, m) => level !== "debug" && log(`[${level}] ${m}`),
  });
  const ready = presetReady(o.preset);

  app.get("/api/health", (c) =>
    c.json(
      ready
        ? { live: true, preset: o.preset.name, model: o.preset.model, budgetUsd: budget.capUsd, spentUsd: budget.spentUsd }
        : { live: false, preset: o.preset.name, reason: `${o.preset.keyEnv} is not set` },
    ),
  );

  app.post("/api/systemone", async (c) => {
    if (!ready) return c.json({ error: `${o.preset.keyEnv} is not set on the server` }, 503);
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: "body must be JSON" }, 400);
    }
    const parsed = WireRequestSchema.safeParse(raw);
    if (!parsed.success) return c.json({ error: "request does not match the /v1/systemone schema", issues: parsed.error.issues.slice(0, 5) }, 422);
    const body = parsed.data;
    if (body.model !== o.preset.model) return c.json({ error: `model mismatch: this server is pinned to ${o.preset.model}` }, 400);
    const hash = await hashJson({ model: body.model, state: body.state, questions: body.questions });
    const file = join(cacheDir, `${hash}.json`);
    const t0 = Date.now();
    if (existsSync(file)) {
      c.header("x-crosstalk-cache", "hit");
      log(`POST /api/systemone ${hash.slice(0, 12)} cache hit`);
      return c.json(JSON.parse(readFileSync(file, "utf8")));
    }
    try {
      const json = await guarded(JSON.stringify(body).length, limiter, budget, async () => {
        const r = await http.sendWire(body);
        const res = fromWire(r.json, body as unknown as DecideRequest, { backend: "http", requestHash: hash, wallMs: r.wallMs, cached: false, retries: r.retries });
        return { value: r.json, costUsd: res.usage.costUsd ?? 0, inputTokens: res.usage.inputTokens };
      });
      mkdirSync(cacheDir, { recursive: true });
      writeFileSync(file, JSON.stringify(json));
      c.header("x-crosstalk-cache", "miss");
      log(`POST /api/systemone ${hash.slice(0, 12)} 200 ${Date.now() - t0} ms · spent $${budget.spentUsd.toFixed(5)} of $${budget.capUsd.toFixed(2)}`);
      return c.json(json as Record<string, unknown>);
    } catch (e) {
      const err = e as CrosstalkError;
      const status = e instanceof BudgetExceeded ? 402 : e instanceof AuthError ? 401 : e instanceof ValidationError ? 422 : e instanceof RateLimitError ? 429 : 502;
      log(`POST /api/systemone ${hash.slice(0, 12)} ${status} ${err.code ?? "error"}: ${err.message}`);
      return c.json({ error: redact(err.message ?? String(e), [o.preset.apiKey]), code: err.code ?? "error", ...(e instanceof ValidationError ? { upstream: e.body } : {}) }, status);
    }
  });

  return { app, budget };
}
