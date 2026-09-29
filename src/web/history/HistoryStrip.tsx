import { motion } from "motion/react";
import { useMemo } from "react";
import { accuracy, scoreRun, totalLeak } from "../../core/eval/metrics.ts";
import { devItems } from "../data.ts";
import { keyFor, restoreVersion, useStore, viewVersionById } from "../store.ts";
import { pct } from "../lib/format.ts";

interface Point {
  id: string;
  acc: number;
  leak: number;
  /** Failed items in this version's run (a partial run). */
  failed: number;
  scored: number;
  changed: string[];
  restoredFrom?: string;
}

export function HistoryStrip({ compact = false }: { compact?: boolean }) {
  const versions = useStore((s) => s.versions);
  const runs = useStore((s) => s.runs);
  const backend = useStore((s) => s.backend);
  const currentId = useStore((s) => s.currentId);
  const viewId = useStore((s) => s.viewId);
  const active = useStore((s) => s.active);
  const health = useStore((s) => s.health);
  const points: Point[] = useMemo(
    () =>
      versions.map((v) => {
        const r = runs[keyFor(v.hash, backend, "dev", useStore.getState())];
        if (!r) return { id: v.id, acc: NaN, leak: NaN, failed: 0, scored: 0, changed: v.changed, restoredFrom: v.restoredFrom };
        const s = scoreRun(devItems, r);
        const a = accuracy(s);
        // a partial run is not comparable: its accuracy is shown, marked, and left out of the sparklines
        return { id: v.id, acc: a.all.p, leak: r.errors ? NaN : totalLeak(s), failed: r.errors, scored: a.all.n, changed: v.changed, restoredFrom: v.restoredFrom };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [versions, runs, backend, health],
  );
  const viewing = viewId && viewId !== currentId;
  return (
    <div className={`flex h-full items-center gap-5 px-4 ${compact ? "flex-col items-stretch gap-3 py-3" : ""}`} data-testid="history">
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <span className="eyebrow shrink-0">History</span>
        <div className="scroll-thin flex min-w-0 items-center overflow-x-auto py-2" data-testid="history-nodes">
          {points.map((p, i) => {
            const prev = i > 0 ? points[i - 1]! : null;
            const d = prev && !p.failed && !prev.failed && Number.isFinite(p.acc) && Number.isFinite(prev.acc) ? p.acc - prev.acc : NaN;
            const isCur = p.id === currentId;
            const isView = p.id === viewId;
            const running = active?.versionId === p.id && active.split === "dev";
            return (
              <div key={p.id} className="flex items-center">
                {i > 0 && <div className="h-px w-8 bg-gradient-to-r from-line-2 to-line" />}
                <motion.button
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: "spring", stiffness: 260, damping: 20 }}
                  onClick={() => viewVersionById(p.id)}
                  className={`group flex items-center gap-2 rounded-lg border px-2 py-1.5 transition-colors ${
                    isView ? "border-signal/50 bg-signal/10" : "border-transparent hover:border-line hover:bg-panel-2"
                  }`}
                  title={`${p.changed.length ? `Changed: ${p.changed.join(", ")}` : p.restoredFrom ? `Restored from ${p.restoredFrom}` : "Derived from the spec only"}${p.failed ? ` · partial: ${p.scored} of ${p.scored + p.failed} scored` : ""}`}
                  aria-disabled={!!active}
                  data-testid="history-node"
                  data-version={p.id}
                >
                  <span className="relative flex h-3 w-3 items-center justify-center">
                    <span
                      className={`h-2.5 w-2.5 rounded-full border-2 ${
                        running ? "animate-pulse border-signal bg-signal/40" : isCur ? "border-signal bg-signal" : Number.isFinite(d) && d < 0 ? "border-broke bg-bg" : "border-muted bg-bg"
                      }`}
                    />
                  </span>
                  <span className="text-left">
                    <span className="mono block text-[11px] leading-3 text-text">
                      {p.id}
                      {isCur && <span className="ml-1 text-[9px] text-signal">current</span>}
                    </span>
                    <span className="num block text-[10px] leading-4 text-muted">
                      {Number.isFinite(p.acc) ? pct(p.acc) : running ? "…" : "—"}
                      {p.failed > 0 ? (
                        <span className="text-err" data-testid="history-partial">
                          {" "}
                          partial
                        </span>
                      ) : (
                        Number.isFinite(d) && d !== 0 && <span className={d > 0 ? "text-fixed" : "text-broke"}> {d > 0 ? "▲" : "▼"}</span>
                      )}
                    </span>
                  </span>
                </motion.button>
              </div>
            );
          })}
        </div>
        {points.length === 1 && !compact && (
          <p className="hidden max-w-[420px] text-[11.5px] leading-[1.45] text-faint xl:block">
            v0 is the spec text alone. Each save adds a version with its own dev run; restoring one that already ran costs nothing.
          </p>
        )}
        {viewing && (
          <div className="flex shrink-0 items-center gap-2">
            <span className="mono text-[10.5px] text-muted">viewing {viewId}</span>
            <button className="btn h-7 text-[11.5px]" onClick={() => void restoreVersion(viewId!)} disabled={!!active} data-testid="restore">
              Restore
            </button>
            <button className="btn btn-ghost h-7 text-[11.5px]" onClick={() => viewVersionById(currentId!)}>
              Back to current
            </button>
          </div>
        )}
      </div>
      <div className={`flex shrink-0 items-center gap-5 ${compact ? "justify-between" : ""}`}>
        <Spark label="dev accuracy" values={points.map((p) => (p.failed ? NaN : p.acc))} format={(x) => pct(x)} color="var(--signal)" />
        <Spark label="total leak" values={points.map((p) => p.leak)} format={(x) => x.toFixed(1)} color="var(--err)" />
      </div>
    </div>
  );
}

function Spark({ label, values, format, color }: { label: string; values: number[]; format: (x: number) => string; color: string }) {
  const vals = values.filter(Number.isFinite);
  const W = 120;
  const H = 30;
  const last = vals[vals.length - 1];
  let d = "";
  let dots: [number, number][] = [];
  if (vals.length) {
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const span = hi - lo || 1;
    const n = Math.max(1, values.length - 1);
    dots = values.flatMap((v, i) => (Number.isFinite(v) ? [[(i / n) * (W - 8) + 4, H - 5 - ((v - lo) / span) * (H - 10)] as [number, number]] : []));
    if (values.length === 1) dots = [[W / 2, H / 2]];
    d = dots.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
  }
  return (
    <div className="flex items-center gap-2.5">
      <svg width={W} height={H} aria-hidden>
        <line x1={0} y1={H - 1} x2={W} y2={H - 1} stroke="var(--line)" />
        {d && <path d={d} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />}
        {dots.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={i === dots.length - 1 ? 2.8 : 1.8} fill={i === dots.length - 1 ? color : "var(--bg)"} stroke={color} strokeWidth={1.2} />
        ))}
      </svg>
      <div className="w-[96px]">
        <div className="eyebrow !text-[9px]">{label}</div>
        <div className="num text-[13px] text-text">{last !== undefined ? format(last) : "—"}</div>
      </div>
    </div>
  );
}
