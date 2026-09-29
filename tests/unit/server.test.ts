import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createLiveApp } from "../../server/live.ts";
import { cacheNamespace, resolvePreset, type Preset } from "../../server/presets.ts";

const KEY = "ts-live-SECRET-9f8e7d6c5b4a";
const TOKEN = "test-token-0123456789";
const PORT = 8787;
const dir = mkdtempSync(join(tmpdir(), "crosstalk-cache-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const body = {
  state: { request: "Hang up call CAxxxx0042 now." },
  model: "jev-1.13.0",
  questions: { operation: { type: "choice", instructions: "Which?", criteria: { UpdateCall: "terminates a call", DeleteCall: "deletes a record" } } },
};
const upstream = {
  model: "jev-1.13.0",
  answers: { operation: { type: "choice", choice: "UpdateCall", probabilities: { UpdateCall: 0.93, DeleteCall: 0.07 }, confidence: 0.86 } },
  usage: { input_tokens: 1000, output_tokens: 0 },
};

interface SetupOptions {
  budgetUsd?: number;
  status?: number;
  reply?: unknown;
  preset?: Preset;
  cacheDir?: string;
}

function setup(o: SetupOptions = {}) {
  const calls: { url: string; auth: string | undefined; body: string }[] = [];
  const logs: string[] = [];
  const status = o.status ?? 200;
  const fakeFetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, auth: (init.headers as Record<string, string>).authorization, body: String(init.body) });
    const reply = o.reply ?? (status === 200 ? upstream : { error: "nope" });
    return new Response(typeof reply === "string" ? reply : JSON.stringify(reply), { status });
  }) as unknown as typeof fetch;
  const preset = o.preset ?? resolvePreset({ CROSSTALK_PRESET: "typesafe", TYPESAFE_API_KEY: KEY } as NodeJS.ProcessEnv);
  const cacheDir = o.cacheDir ?? join(dir, String(Math.random()).slice(2));
  const { app, budget } = createLiveApp({
    preset,
    budgetUsd: o.budgetUsd ?? 1,
    port: PORT,
    token: TOKEN,
    cacheDir,
    fetch: fakeFetch,
    log: (l) => logs.push(l),
    sleep: async () => {},
  });
  return { app, calls, logs, budget, cacheDir };
}

type App = ReturnType<typeof setup>["app"];
const okHeaders = { host: `127.0.0.1:${PORT}`, "content-type": "application/json", "x-crosstalk-token": TOKEN };

const post = (app: App, b: unknown, headers: Record<string, string> = okHeaders) =>
  app.request("/api/systemone", { method: "POST", headers, body: typeof b === "string" ? b : JSON.stringify(b) });
const health = (app: App, headers: Record<string, string> = { host: `127.0.0.1:${PORT}` }) => app.request("/api/health", { headers });

describe("live server with a fake upstream (no key needed)", () => {
  it("reports health without the key, with the per-process token", async () => {
    const { app } = setup();
    const res = await health(app);
    const j = await res.json();
    expect(j).toMatchObject({ live: true, preset: "typesafe", model: "jev-1.13.0", budgetUsd: 1, spentUsd: 0, token: TOKEN });
    expect(JSON.stringify(j)).not.toContain(KEY);
  });

  it("reports live=false when no key is set", async () => {
    const preset = resolvePreset({ CROSSTALK_PRESET: "typesafe" } as NodeJS.ProcessEnv);
    const { app } = createLiveApp({ preset, budgetUsd: 1, port: PORT, cacheDir: dir, log: () => {} });
    expect(await (await health(app)).json()).toMatchObject({ live: false });
    expect((await post(app, body)).status).toBe(503);
  });

  it("forwards with the key and the model, charges the budget, and caches by request hash", async () => {
    const { app, calls, logs } = setup();
    const r1 = await post(app, body);
    expect(r1.status).toBe(200);
    expect(r1.headers.get("x-crosstalk-cache")).toBe("miss");
    expect(await r1.json()).toEqual(upstream);
    expect(calls[0]!.url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(calls[0]!.auth).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(calls[0]!.body).model).toBe("jev-1.13.0");
    const r2 = await post(app, body);
    expect(r2.headers.get("x-crosstalk-cache")).toBe("hit");
    expect(calls).toHaveLength(1);
    const r3 = await post(app, body, { ...okHeaders, "x-crosstalk-cache": "bypass" });
    expect(r3.headers.get("x-crosstalk-cache")).toBe("miss");
    expect(calls).toHaveLength(2);
    const h = await (await health(app)).json();
    expect(h.spentUsd).toBeCloseTo(2 * 1000 * 0.042e-6, 12);
    expect(logs.join("\n")).not.toContain(KEY);
  });

  it("refuses when the budget cap would be passed (402) and never calls upstream", async () => {
    const { app, calls } = setup({ budgetUsd: 0.0000001 });
    const r = await post(app, body);
    expect(r.status).toBe(402);
    expect((await r.json()).code).toBe("budget");
    expect(calls).toHaveLength(0);
  });

  it("rejects a body that does not match the schema, or a different model", async () => {
    const { app, calls } = setup();
    expect((await post(app, { ...body, model: "" })).status).toBe(422);
    expect((await post(app, { ...body, model: "jev-latest" })).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("checks the documented limits before any budget or upstream call (422, zero calls)", async () => {
    const { app, calls, budget } = setup();
    const many = Object.fromEntries(Array.from({ length: 256 }, (_, i) => [`op${i}`, null]));
    const tooMany = { ...body, questions: { operation: { type: "choice", instructions: "Which?", criteria: many } } };
    const badScore = { ...body, questions: { q: { type: "score", instructions: "How?", criteria: ["only one level"] } } };
    const noQuestions = { ...body, questions: {} };
    for (const b of [tooMany, badScore, noQuestions]) {
      const r = await post(app, b);
      expect(r.status).toBe(422);
      expect((await r.json()).code).toBe("request");
    }
    expect(calls).toHaveLength(0);
    expect(budget.spentUsd).toBe(0);
    expect(budget.reservedUsd).toBe(0);
  });

  it("maps an upstream 401 without leaking the key", async () => {
    const { app, logs } = setup({ status: 401 });
    const r = await post(app, { ...body, state: { request: "different" } });
    expect(r.status).toBe(401);
    const text = await r.text();
    expect(text + logs.join("\n")).not.toContain(KEY);
  });

  it("never writes the key into the cache, even when the upstream echoes it", async () => {
    const echo = { ...upstream, echoed: `Authorization: Bearer ${KEY}`, note: KEY };
    const { app, cacheDir } = setup({ reply: echo });
    const r = await post(app, { ...body, state: { request: "echo test" } });
    expect(r.status).toBe(200);
    expect(await r.text()).not.toContain(KEY);
    const ns = join(cacheDir, readdirSync(cacheDir)[0]!);
    const files = readdirSync(ns);
    expect(files).toHaveLength(1);
    for (const f of files) {
      expect(f).not.toContain(KEY);
      expect(readFileSync(join(ns, f), "utf8")).not.toContain(KEY);
    }
  });

  it("charges a response that arrived (200) but did not parse: its usage, never $0", async () => {
    const bad = { model: "jev-1.13.0", answers: { operation: { type: "choice", choice: "Nope", probabilities: { Nope: 1 } } }, usage: { input_tokens: 2000 } };
    const { app, budget } = setup({ reply: bad });
    const r = await post(app, body);
    expect(r.status).toBe(502);
    expect(budget.spentUsd).toBeCloseTo(2000 * 0.042e-6, 12);
    expect(budget.reservedUsd).toBe(0);
  });

  it("a 200 with no usage at all is charged at the reserved estimate, not $0", async () => {
    const noUsage = { model: "jev-1.13.0", answers: upstream.answers, usage: {} };
    const { app, budget } = setup({ reply: noUsage });
    const r = await post(app, body);
    expect(r.status).toBe(200);
    const reserveEstimate = Math.ceil(JSON.stringify(body).length / 3) * 0.042e-6;
    expect(budget.spentUsd).toBeCloseTo(reserveEstimate, 12);
  });

  it("refuses a negative reported cost (it can never lower spend)", async () => {
    const neg = { ...upstream, usage: { input_tokens: 1000, cost: -5 } };
    const { app, budget } = setup({ reply: neg });
    const r = await post(app, body);
    expect(r.status).toBe(502);
    expect(budget.spentUsd).toBeGreaterThan(0);
  });
});

describe("live server: only the local app may spend", () => {
  it("refuses a hostile Origin, a hostile Host, and a text/plain simple POST, with zero upstream calls", async () => {
    const { app, calls, budget } = setup();
    const cases: [string, Record<string, string>][] = [
      ["hostile origin", { ...okHeaders, origin: "https://evil.example" }],
      ["null origin", { ...okHeaders, origin: "null" }],
      ["DNS-rebinding host", { ...okHeaders, host: `evil.example:${PORT}` }],
      ["other port", { ...okHeaders, host: "127.0.0.1:9999" }],
      ["text/plain simple POST", { host: `127.0.0.1:${PORT}`, "content-type": "text/plain", "x-crosstalk-token": TOKEN }],
      ["no token", { host: `127.0.0.1:${PORT}`, "content-type": "application/json" }],
      ["wrong token", { ...okHeaders, "x-crosstalk-token": "guess" }],
    ];
    for (const [name, headers] of cases) {
      const r = await post(app, body, headers);
      expect([403, 415], name).toContain(r.status);
    }
    expect(calls).toHaveLength(0);
    expect(budget.spentUsd).toBe(0);
  });

  it("does not hand the token to another origin or host", async () => {
    const { app } = setup();
    expect((await health(app, { host: `127.0.0.1:${PORT}`, origin: "https://evil.example" })).status).toBe(403);
    expect((await health(app, { host: "attacker.example" })).status).toBe(403);
  });

  it("accepts the Vite dev origin", async () => {
    const { app } = setup();
    const r = await post(app, { ...body, state: { request: "from vite" } }, { ...okHeaders, origin: "http://127.0.0.1:5173" });
    expect(r.status).toBe(200);
  });
});

describe("live server: the cache is keyed by upstream", () => {
  it("never serves answers cached for one upstream to another", async () => {
    const shared = join(dir, "shared");
    const fake = resolvePreset({ CROSSTALK_PRESET: "compat", CROSSTALK_COMPAT_URL: "http://127.0.0.1:8790", CROSSTALK_MODEL: "jev-1.13.0" } as NodeJS.ProcessEnv);
    const real = resolvePreset({ CROSSTALK_PRESET: "typesafe", TYPESAFE_API_KEY: KEY } as NodeJS.ProcessEnv);
    const a = setup({ preset: fake, cacheDir: shared });
    expect((await post(a.app, body)).headers.get("x-crosstalk-cache")).toBe("miss");
    expect((await post(a.app, body)).headers.get("x-crosstalk-cache")).toBe("hit");
    const b = setup({ preset: real, cacheDir: shared });
    expect((await post(b.app, body)).headers.get("x-crosstalk-cache")).toBe("miss");
    expect(b.calls).toHaveLength(1);
    expect(cacheNamespace(fake)).not.toBe(cacheNamespace(real));
    for (const ns of [cacheNamespace(fake), cacheNamespace(real)]) expect(statSync(join(shared, ns)).isDirectory()).toBe(true);
  });
});
