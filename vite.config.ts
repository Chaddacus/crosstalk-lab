import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const livePort = Number(process.env.CROSSTALK_PORT ?? 8787);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      // changeOrigin: the proxied Host becomes 127.0.0.1:<port>, which the live server's Host check expects.
      "/api": { target: `http://127.0.0.1:${livePort}`, changeOrigin: true },
    },
  },
  // The static preview has no local server: /api is not proxied, so LIVE stays disabled.
  preview: { host: "127.0.0.1", port: 4173, proxy: {} },
  worker: { format: "es" },
  build: { target: "es2023", sourcemap: true, chunkSizeWarningLimit: 900 },
});
