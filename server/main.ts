/** Start the local live server on 127.0.0.1 (never on a public interface). `npm run live` also starts Vite. */
import { serve } from "@hono/node-server";
import { DEFAULT_WEB_ORIGINS, createLiveApp } from "./live.ts";
import { loadDotEnv, presetReady, resolvePreset } from "./presets.ts";

loadDotEnv();
const preset = resolvePreset();
const env = process.env;
const port = Number(env.CROSSTALK_PORT ?? 8787);
const budgetUsd = Number(env.CROSSTALK_BUDGET_USD ?? "0.50");
const allowedOrigins = env.CROSSTALK_WEB_ORIGINS ? env.CROSSTALK_WEB_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean) : DEFAULT_WEB_ORIGINS;
const { app, cacheDir } = createLiveApp({
  preset,
  budgetUsd,
  port,
  allowedOrigins,
  cacheDir: env.CROSSTALK_CACHE_DIR || undefined,
  requestsPerMinute: env.CROSSTALK_RPM ? Number(env.CROSSTALK_RPM) : undefined,
  deadlineMs: env.CROSSTALK_DEADLINE_MS ? Number(env.CROSSTALK_DEADLINE_MS) : undefined,
});

serve({ fetch: app.fetch, hostname: "127.0.0.1", port }, () => {
  console.log(`crosstalk live server on http://127.0.0.1:${port}  preset ${preset.name} · model ${preset.model} · budget $${budgetUsd.toFixed(2)}`);
  console.log(`  answers only the local app (${allowedOrigins.join(", ")}); cache ${cacheDir}`);
  if (!presetReady(preset)) console.log(`  ${preset.keyEnv} is not set: /api/health reports live=false and the UI keeps LIVE disabled.`);
});
