import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createLiveApp } from "../../server/live.ts";
import { resolvePreset } from "../../server/presets.ts";

const KEY = "ts-live-SECRET-9f8e7d6c5b4a";
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

function setup(budgetUsd = 1, status = 200) {
  const calls: { url: string; auth: string | undefined; body: string }[] = [];
  const logs: string[] = [];
  const fakeFetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, auth: (init.headers as Record<string, string>).authorization, body: String(init.body) });
    return new Response(JSON.stringify(status === 200 ? upstream : { error: "nope" }), { status });
  }) as unknown as typeof fetch;
  const preset = resolvePreset({ CROSSTALK_PRESET: "typesafe", TYPESAFE_API_KEY: KEY } as NodeJS.ProcessEnv);
  const { app } = createLiveApp({ preset, budgetUsd, cacheDir: join(dir, String(Math.random())), fetch: fakeFetch, log: (l) => logs.push(l), sleep: async () => {} });
  return { app, calls, logs };
}

const post = (app: ReturnType<typeof setup>["app"], b: unknown) =>
  app.request("/api/systemone", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });

describe("live server with a fake upstream (no key needed)", () => {
  it("reports health without the key", async () => {
    const { app } = setup();
    const res = await app.request("/api/health");
    const j = await res.json();
    expect(j).toMatchObject({ live: true, preset: "typesafe", model: "jev-1.13.0", budgetUsd: 1, spentUsd: 0 });
    expect(JSON.stringify(j)).not.toContain(KEY);
  });

  it("reports live=false when no key is set", async () => {
    const preset = resolvePreset({ CROSSTALK_PRESET: "typesafe" } as NodeJS.ProcessEnv);
    const { app } = createLiveApp({ preset, budgetUsd: 1, cacheDir: dir, log: () => {} });
    expect(await (await app.request("/api/health")).json()).toMatchObject({ live: false });
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
    const health = await (await app.request("/api/health")).json();
    expect(health.spentUsd).toBeCloseTo(1000 * 0.042e-6, 12);
    expect(logs.join("\n")).not.toContain(KEY);
  });

  it("refuses when the budget cap would be passed (402) and never calls upstream", async () => {
    const { app, calls } = setup(0.0000001);
    const r = await post(app, body);
    expect(r.status).toBe(402);
    expect(calls).toHaveLength(0);
  });

  it("rejects a body that does not match the schema, or a different model", async () => {
    const { app, calls } = setup();
    expect((await post(app, { ...body, model: "" })).status).toBe(422);
    expect((await post(app, { ...body, model: "jev-latest" })).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("maps an upstream 401 without leaking the key", async () => {
    const { app, logs } = setup(1, 401);
    const r = await post(app, { ...body, state: { request: "different" } });
    expect(r.status).toBe(401);
    const text = await r.text();
    expect(text + logs.join("\n")).not.toContain(KEY);
  });

  it("never writes the key into the cache", () => {
    for (const d of readdirSync(dir)) expect(d).not.toContain(KEY);
  });
});
