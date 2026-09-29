import { describe, expect, it } from "vitest";
import { createHttpBackend, parseRetryAfter } from "../../src/core/jev/http.ts";
import { AbortedError, AuthError, RateLimitError, TimeoutError, ValidationError } from "../../src/core/jev/errors.ts";
import type { DecideRequest } from "../../src/core/jev/types.ts";

const KEY = "ts-live-SECRETKEY-0123456789abcdef";

const req: DecideRequest = {
  model: "jev-1.13.0",
  state: { request: "hang up call CAxxxx0042" },
  questions: { operation: { type: "choice", instructions: "Which?", criteria: { UpdateCall: "terminates a call", DeleteCall: "deletes a call record" } } },
};
const okBody = {
  model: "jev-1.13.0",
  answers: { operation: { type: "choice", choice: "UpdateCall", probabilities: { UpdateCall: 0.9, DeleteCall: 0.1 }, confidence: 0.8 } },
  usage: { input_tokens: 100, output_tokens: 0 },
};

type Step = { status: number; body?: unknown; headers?: Record<string, string> } | { throws: string } | { hang: true };

function fakeFetch(steps: Step[]) {
  const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: String(init.body) });
    const s = steps[Math.min(calls.length - 1, steps.length - 1)]!;
    if ("throws" in s) throw new Error(s.throws);
    if ("hang" in s) {
      return new Promise<Response>((_, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    }
    return new Response(s.body === undefined ? "" : JSON.stringify(s.body), { status: s.status, headers: s.headers });
  }) as unknown as typeof fetch;
  return { f, calls };
}

function backend(steps: Step[], extra: Partial<Parameters<typeof createHttpBackend>[0]> = {}) {
  const { f, calls } = fakeFetch(steps);
  const sleeps: number[] = [];
  const logs: string[] = [];
  const b = createHttpBackend({
    baseUrl: "https://api.example.com/",
    apiKey: KEY,
    fetch: f,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    random: () => 0.5,
    now: () => 1_000_000,
    logger: (l, m) => logs.push(`${l} ${m}`),
    ...extra,
  });
  return { b, calls, sleeps, logs };
}

describe("http backend", () => {
  it("posts the wire body with a bearer key to /v1/systemone", async () => {
    const { b, calls } = backend([{ status: 200, body: okBody }]);
    const r = await b.decide(req);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.example.com/v1/systemone");
    expect(calls[0]!.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(calls[0]!.body).model).toBe("jev-1.13.0");
    expect(r.decisions.operation).toMatchObject({ chosen: "UpdateCall", confidenceSource: "reported" });
    expect(r.meta.retries).toBe(0);
  });

  it.each([408, 429, 500, 529])("retries %i with exponential backoff and jitter", async (status) => {
    const { b, calls, sleeps } = backend([{ status }, { status }, { status: 200, body: okBody }]);
    const r = await b.decide(req);
    expect(calls).toHaveLength(3);
    expect(r.meta.retries).toBe(2);
    // backoff = min(500·2^attempt, 5000) × (1 − 0.25 × random), random = 0.5
    expect(sleeps).toEqual([500 * 0.875, 1000 * 0.875]);
  });

  it("gives up after maxRetries (2) and throws the typed error", async () => {
    const { b, calls } = backend([{ status: 429 }]);
    await expect(b.decide(req)).rejects.toBeInstanceOf(RateLimitError);
    expect(calls).toHaveLength(3);
  });

  it("honors retry-after-ms, Retry-After seconds and Retry-After HTTP dates", async () => {
    const date = new Date(1_000_000 + 3000).toUTCString();
    const { b, sleeps } = backend([
      { status: 429, headers: { "retry-after-ms": "1500", "retry-after": "9" } },
      { status: 503, headers: { "retry-after": "2" } },
      { status: 200, body: okBody },
    ]);
    await b.decide(req);
    expect(sleeps).toEqual([1500, 2000]);
    const h = new Headers({ "retry-after": date });
    // Date.parse drops milliseconds; 1_000_000 ms has none.
    expect(parseRetryAfter(h, 1_000_000)).toBe(3000);
  });

  it("caps the server wait: a Retry-After over 60 s falls back to backoff", async () => {
    const { b, sleeps } = backend([{ status: 429, headers: { "retry-after": "120" } }, { status: 200, body: okBody }]);
    await b.decide(req);
    expect(sleeps).toEqual([437.5]);
    expect(Math.max(...sleeps)).toBeLessThanOrEqual(60_000);
  });

  it("does not retry 401", async () => {
    const { b, calls } = backend([{ status: 401, body: { error: "bad key" } }]);
    await expect(b.decide(req)).rejects.toBeInstanceOf(AuthError);
    expect(calls).toHaveLength(1);
  });

  it("does not retry 422 and keeps the body", async () => {
    const body = { detail: [{ loc: ["body", "model"], msg: "field required" }] };
    const { b, calls } = backend([{ status: 422, body }]);
    const err = await b.decide(req).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).body).toEqual(body);
    expect(calls).toHaveLength(1);
  });

  it("times out and retries timeouts, then throws TimeoutError", async () => {
    const { b, calls } = backend([{ hang: true }], { timeoutMs: 15, retry: { maxRetries: 1 } });
    await expect(b.decide(req)).rejects.toBeInstanceOf(TimeoutError);
    expect(calls).toHaveLength(2);
  });

  it("honors an AbortSignal without retrying", async () => {
    const ctrl = new AbortController();
    const { b, calls } = backend([{ hang: true }], { timeoutMs: 5000 });
    const p = b.decide(req, { signal: ctrl.signal });
    setTimeout(() => ctrl.abort(), 5);
    await expect(p).rejects.toBeInstanceOf(AbortedError);
    expect(calls).toHaveLength(1);
  });

  it("retries connection errors", async () => {
    const { b, calls } = backend([{ throws: "ECONNRESET" }, { status: 200, body: okBody }]);
    await b.decide(req);
    expect(calls).toHaveLength(2);
  });

  it("never puts the key in logs or errors (redaction)", async () => {
    const { b, logs } = backend([{ throws: `socket hang up; headers: authorization: Bearer ${KEY}` }, { status: 500, body: { echo: KEY } }, { status: 500 }], {
      retry: { maxRetries: 2 },
    });
    const err = (await b.decide(req).catch((e) => e)) as Error;
    const everything = [err.message, String(err.stack), JSON.stringify(err), ...logs].join("\n");
    expect(logs.length).toBeGreaterThan(0);
    expect(everything).not.toContain(KEY);
    expect(everything).not.toContain("SECRETKEY");
  });
});
