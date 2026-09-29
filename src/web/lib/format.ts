export const pct = (x: number, digits = 1) => (Number.isFinite(x) ? `${(x * 100).toFixed(digits)}%` : "—");
export const pts = (x: number, digits = 1) => (Number.isFinite(x) ? `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(digits)}` : "—");
export const num = (x: number, digits = 2) => (Number.isFinite(x) ? x.toFixed(digits) : "—");
export const usd = (x: number) => (!Number.isFinite(x) ? "—" : x === 0 ? "$0.000" : x < 0.001 ? `$${x.toFixed(5)}` : `$${x.toFixed(4)}`);
export const secs = (ms: number) => (!Number.isFinite(ms) ? "—" : ms < 1000 ? `${Math.max(0, ms).toFixed(0)} ms` : `${(ms / 1000).toFixed(2)} s`);
export const int = (x: number) => (Number.isFinite(x) ? Math.round(x).toLocaleString("en-US") : "—");
export const short = (h: string, n = 8) => h.slice(0, n);
