/**
 * HTTP backend for any server that speaks `POST /v1/systemone` (TypeSafe direct, OpenRouter, a Kev or Laya
 * server, or the local Crosstalk proxy at `/api/systemone`).
 *
 * Retry policy copies the TypeSafe JS SDK defaults [C: RetryPolicy docs]:
 *   maxRetries 2; backoff 500 ms doubling to 5,000 ms; jitter 0.25 (fraction subtracted);
 *   retry statuses 408, 429, 500-599 (covers 529); honor Retry-After and retry-after-ms up to 60,000 ms
 *   (longer server delays fall back to backoff); retry connection errors and timeouts. Never retry 401 or 422.
 * Clock, sleep and random source are injectable so tests are fast and repeatable.
 * The key is only ever placed in the Authorization header. It is never logged or put in an error.
 */
import {
  AbortedError,
  AuthError,
  ConnectionError,
  CrosstalkError,
  HttpError,
  OverloadedError,
  RateLimitError,
  TimeoutError,
  ValidationError,
  redact,
} from "./errors.ts";
import type { DecideOptions, DecideRequest, DecideResult, DecisionBackend } from "./types.ts";
import { fromWire, toWire, type WireRequest } from "./wire.ts";
import { hashJson } from "./canonical.ts";

export interface RetryPolicy {
  maxRetries: number;
  backoffInitialMs: number;
  backoffMaxMs: number;
  backoffJitter: number;
  httpStatuses: ReadonlySet<number>;
  maxRetryAfterMs: number;
  respectRetryAfter: boolean;
  retryConnectionErrors: boolean;
  retryTimeouts: boolean;
}

const RETRY_STATUSES = new Set([408, 429, ...Array.from({ length: 100 }, (_, i) => 500 + i)]);

export const DEFAULT_RETRY: RetryPolicy = {
  maxRetries: 2,
  backoffInitialMs: 500,
  backoffMaxMs: 5000,
  backoffJitter: 0.25,
  httpStatuses: RETRY_STATUSES,
  maxRetryAfterMs: 60_000,
  respectRetryAfter: true,
  retryConnectionErrors: true,
  retryTimeouts: true,
};

export type Logger = (level: "debug" | "info" | "warn", message: string) => void;

export interface HttpBackendConfig {
  /** For example https://api.typesafe.ai, https://openrouter.ai/api, http://127.0.0.1:8000, or "" for same-origin. */
  baseUrl: string;
  /** Path appended to baseUrl. Default `/v1/systemone`. The browser uses `/api/systemone`. */
  path?: string;
  apiKey?: string;
  label?: string;
  timeoutMs?: number;
  retry?: Partial<RetryPolicy>;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  now?: () => number;
  logger?: Logger;
  extraHeaders?: Record<string, string>;
}

/** Parse `retry-after-ms` (milliseconds) or `Retry-After` (seconds or an HTTP date). Returns ms or null. */
export function parseRetryAfter(headers: Headers, now: number): number | null {
  const ms = headers.get("retry-after-ms");
  if (ms !== null && ms.trim() !== "") {
    const v = Number(ms);
    if (Number.isFinite(v) && v >= 0) return v;
  }
  const ra = headers.get("retry-after");
  if (ra !== null && ra.trim() !== "") {
    const secs = Number(ra);
    if (Number.isFinite(secs) && secs >= 0) return secs * 1000;
    const date = Date.parse(ra);
    if (!Number.isNaN(date)) return Math.max(0, date - now);
  }
  return null;
}

export function backoffDelay(attempt: number, p: RetryPolicy, random: () => number): number {
  const base = Math.min(p.backoffInitialMs * 2 ** attempt, p.backoffMaxMs);
  return base * (1 - p.backoffJitter * random());
}

export interface WireCallResult {
  json: unknown;
  status: number;
  retries: number;
  wallMs: number;
}

export function createHttpBackend(cfg: HttpBackendConfig): DecisionBackend & {
  /** Send an already-built wire body and return the raw JSON (used by the local proxy and its cache). */
  sendWire(body: WireRequest, opts?: DecideOptions): Promise<WireCallResult>;
} {
  const policy: RetryPolicy = { ...DEFAULT_RETRY, ...cfg.retry };
  const doFetch = cfg.fetch ?? globalThis.fetch.bind(globalThis);
  const sleep = cfg.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = cfg.random ?? Math.random;
  const now = cfg.now ?? (() => Date.now());
  const timeoutMs = cfg.timeoutMs ?? 30_000;
  const url = cfg.baseUrl.replace(/\/+$/, "") + (cfg.path ?? "/v1/systemone");
  const secrets = [cfg.apiKey];
  const log: Logger = (level, message) => cfg.logger?.(level, redact(message, secrets));

  async function attempt(body: string, signal?: AbortSignal): Promise<{ res: Response; text: string }> {
    const ctrl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ctrl.abort();
    }, timeoutMs);
    const onAbort = () => ctrl.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json", ...cfg.extraHeaders };
      if (cfg.apiKey) headers.authorization = `Bearer ${cfg.apiKey}`;
      const res = await doFetch(url, { method: "POST", headers, body, signal: ctrl.signal });
      const text = await res.text();
      return { res, text };
    } catch (e) {
      if (signal?.aborted) throw new AbortedError();
      if (timedOut) throw new TimeoutError(timeoutMs);
      throw new ConnectionError(`connection failed: ${redact((e as Error).message ?? String(e), secrets)}`);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  async function sendWire(wire: WireRequest, opts: DecideOptions = {}): Promise<WireCallResult> {
    const body = JSON.stringify(wire);
    const t0 = now();
    let retries = 0;
    for (;;) {
      if (opts.signal?.aborted) throw new AbortedError();
      let err!: CrosstalkError;
      let retryable = false;
      let wait: number | null = null;
      let got: { res: Response; text: string } | null = null;
      try {
        got = await attempt(body, opts.signal);
      } catch (e) {
        if (!(e instanceof CrosstalkError) || e instanceof AbortedError) throw e;
        err = e;
        retryable = e instanceof TimeoutError ? policy.retryTimeouts : policy.retryConnectionErrors;
      }
      if (got) {
        const { res } = got;
        // Defense in depth: a server that echoes the key back never gets it into an error, a log or a cache.
        const text = redact(got.text, secrets);
        let json: unknown = text;
        try {
          json = text ? JSON.parse(text) : null;
        } catch {
          /* keep the text */
        }
        if (res.ok) return { json, status: res.status, retries, wallMs: now() - t0 };
        if (res.status === 401) throw new AuthError();
        if (res.status === 422) throw new ValidationError(json);
        err = res.status === 429 ? new RateLimitError() : res.status === 529 ? new OverloadedError() : new HttpError(res.status, json);
        retryable = policy.httpStatuses.has(res.status);
        if (retryable && policy.respectRetryAfter) {
          const ra = parseRetryAfter(res.headers, now());
          if (ra !== null && ra <= policy.maxRetryAfterMs) wait = ra;
        }
      }
      if (!retryable || retries >= policy.maxRetries) throw err;
      const delay = wait ?? backoffDelay(retries, policy, random);
      log("warn", `${err.message}; retry ${retries + 1}/${policy.maxRetries} in ${Math.round(delay)} ms`);
      retries++;
      await sleep(delay);
    }
  }

  return {
    kind: "http",
    label: cfg.label ?? "http",
    sendWire,
    async decide(req: DecideRequest, opts?: DecideOptions): Promise<DecideResult> {
      const wire = toWire(req);
      const requestHash = await hashJson({ model: wire.model, state: wire.state, questions: wire.questions });
      const r = await sendWire(wire, opts);
      return fromWire(r.json, req, { backend: "http", requestHash, wallMs: r.wallMs, cached: false, retries: r.retries });
    },
  };
}
