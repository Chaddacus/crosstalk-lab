/**
 * A fake `/v1/systemone` upstream for exercising the LIVE path offline: it answers with the lexical mock.
 * It is NOT Jev. Use it with the compat preset:
 *   npx tsx scripts/fake-upstream.ts            (listens on 127.0.0.1:8790)
 *   CROSSTALK_PRESET=compat CROSSTALK_COMPAT_URL=http://127.0.0.1:8790 CROSSTALK_MODEL=fake-lexsim npm run live
 */
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createMockBackend } from "../src/core/jev/mock-lexsim.ts";
import { choiceToWire, WireRequestSchema } from "../src/core/jev/wire.ts";
import type { DecideRequest } from "../src/core/jev/types.ts";

const port = Number(process.env.FAKE_UPSTREAM_PORT ?? 8790);
const delayMs = Number(process.env.FAKE_UPSTREAM_DELAY_MS ?? 60);
const mock = createMockBackend();
const app = new Hono();
app.post("/v1/systemone", async (c) => {
  const parsed = WireRequestSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ detail: parsed.error.issues.slice(0, 3) }, 422);
  const req = parsed.data as unknown as DecideRequest;
  await new Promise((r) => setTimeout(r, delayMs * (0.5 + Math.random())));
  const res = await mock.decide(req);
  const [qid, d] = Object.entries(res.decisions)[0]!;
  if (d.kind !== "choice") return c.json({ detail: "fake upstream supports choice only" }, 422);
  return c.json(choiceToWire(req.model, qid, d, res.usage.inputTokens));
});
serve({ fetch: app.fetch, hostname: "127.0.0.1", port }, () => console.log(`fake /v1/systemone (lexical mock, not Jev) on http://127.0.0.1:${port}`));
