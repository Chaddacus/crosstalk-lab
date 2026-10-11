# Crosstalk (repo map)

Typed-decision router confusion map: shows which Twilio v2010 operations a router confuses, lets you
rewrite their wording, and proves the fix on a sealed test set. Runs offline on a deterministic
lexical mock (not Jev); an optional local server proxies a real `/v1/systemone` backend. See README.md.

## Commands (Node >= 24)

- `python dev.py setup` / `npm ci`: install from the lockfile
- `python dev.py dev` (or `npm run dev`): Vite dev server with HMR on 127.0.0.1:5173
- `python dev.py fast`: typecheck + unit tests (the pre-push FAST tier)
- `python dev.py check`: what CI runs (typecheck, unit tests, data lint, build)
- `npm run test:e2e`: Playwright (local only, uses installed Chrome)
- `npm run eval`, `freeze`, `export`: CLI evaluation and export (see README "Tests" and "Backends")
- `npm run live`: local server (8787) plus Vite; needs a key in `.env` (copy `.env.example`)

## Layout

- `src/core/`: framework-free logic (data, eval, jev mock and client, run)
- `src/web/`: React UI (map, editor, gate, seal, history, diff, items), Zustand store, workers
- `server/`: Hono server for LIVE mode (`main.ts`, `live.ts`, `presets.ts`)
- `scripts/`: tsx CLIs (eval, freeze, build-catalog, lint-data, export, demo recording)
- `data/twilio-v2010/`: catalog and dev/test splits with sha256 manifest; `ledger/`: peek ledger; `runs/`: run output
- `tests/unit/` (vitest), `tests/e2e/` (Playwright); `docs/`: screenshots and demo clip

## Rules

- The test split is sealed: only unseal through the app or `eval --unseal`, which appends to `ledger/`. Never edit data hashes by hand.
- Everything shown must stay labeled MOCK unless a real backend produced it.
- Never commit `.env` or keys. CI (`.github/workflows/checks.yml`) must stay green.
