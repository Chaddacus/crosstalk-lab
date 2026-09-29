/** Start the local live server on 127.0.0.1 (never on a public interface). `npm run live` also starts Vite. */
import { serve } from "@hono/node-server";
import { createLiveApp } from "./live.ts";
import { loadDotEnv, presetReady, resolvePreset } from "./presets.ts";

loadDotEnv();
const preset = resolvePreset();
const port = Number(process.env.CROSSTALK_PORT ?? 8787);
const budgetUsd = Number(process.env.CROSSTALK_BUDGET_USD ?? "0.50");
const { app } = createLiveApp({ preset, budgetUsd });

serve({ fetch: app.fetch, hostname: "127.0.0.1", port }, () => {
  console.log(`crosstalk live server on http://127.0.0.1:${port}  preset ${preset.name} · model ${preset.model} · budget $${budgetUsd.toFixed(2)}`);
  if (!presetReady(preset)) console.log(`  ${preset.keyEnv} is not set: /api/health reports live=false and the UI keeps LIVE disabled.`);
});
