import { motion } from "motion/react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { gate, reliability, selective, type Scored } from "../../core/eval/metrics.ts";
import { exportPolicy } from "../../core/eval/export.ts";
import { NONE } from "../../core/data/catalog.ts";
import { deleteOps } from "../data.ts";
import { useAnalysis } from "../analysis.ts";
import { setTau, useStore, viewVersion } from "../store.ts";
import { download } from "../lib/download.ts";
import { pct } from "../lib/format.ts";
import { Ticker } from "../ui/Ticker.tsx";

export function GateView() {
  const { scored, run } = useAnalysis();
  const tau = useStore((s) => s.tau);
  const w = useStore((s) => s.riskWeight);
  const backend = useStore((s) => s.backend);
  const v = useStore((s) => viewVersion(s));
  const g = useMemo(() => gate(scored, tau, deleteOps, w), [scored, tau, w]);
  const sel = useMemo(() => selective(scored), [scored]);
  const rel = useMemo(() => reliability(scored), [scored]);
  const src = scored.find((s) => !s.error)?.confidenceSource ?? "derived";
  const exportIt = () => {
    if (!run || !v) return;
    download(
      exportPolicy({
        tau,
        model: run.model,
        backend: run.backend,
        criteriaHash: v.hash,
        criteriaVersion: v.id,
        confidenceSource: src,
        dev: {
          n: scored.length,
          coverage: g.coverage,
          autoAccuracy: g.auto.p,
          autoLo: g.auto.lo,
          autoHi: g.auto.hi,
          confidentErrors: g.confidentErrors,
          riskConfidentErrors: g.riskConfidentErrors,
          riskWeight: w,
        },
      }),
    );
  };
  return (
    <div className="scroll-thin h-full overflow-y-auto" data-testid="gate-view">
      <div className="mx-auto max-w-[1400px] p-4 md:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="eyebrow">Gate · where the router acts alone</div>
            <h2 className="mt-1.5 text-[20px] font-semibold tracking-tight text-text">Pick a confidence threshold τ</h2>
            <p className="mt-1 max-w-[640px] text-[13px] leading-[1.55] text-muted">
              Items at or above τ go to the AUTO lane. Items below go to a HUMAN. Drag τ and watch coverage, AUTO accuracy and confident errors move.
            </p>
          </div>
          <button className="btn btn-primary" onClick={exportIt} disabled={!run} data-testid="export-policy">
            Export policy.json
          </button>
        </div>
        {backend !== "live" && (
          <div className="mt-4 flex items-start gap-3 rounded-xl border border-post/35 bg-post/[0.07] px-4 py-3 text-[12.5px] leading-[1.5] text-post" data-testid="mock-gate-banner">
            <span className="mono mt-px rounded border border-post/50 px-1.5 text-[10px] font-semibold tracking-wider">MOCK</span>
            <span>Lexical stand-in probabilities are not calibrated. This tab shows the method, not Jev's calibration.</span>
          </div>
        )}
        <div className="mt-5 grid gap-5 lg:grid-cols-[3fr_2fr]">
          <section className="card p-4">
            <div className="flex items-center justify-between">
              <span className="eyebrow !text-[9.5px]">Every dev item by confidence</span>
              <span className="mono text-[10.5px] text-faint">confidence: {src}{src === "derived" ? " · (K·p_max − 1)/(K − 1)" : ""}</span>
            </div>
            <Strip scored={scored} tau={tau} />
            <div className="mono mt-3 flex flex-wrap gap-4 text-[10.5px] text-muted">
              <Dot kind="ok" /> correct
              <Dot kind="bad" /> wrong
              <Dot kind="hollow" /> gold is NO MATCH
              <Dot kind="ring" /> confident error (wrong, in AUTO)
            </div>
          </section>
          <section className="grid grid-cols-2 gap-3 self-start">
            <Kpi label="Coverage" sub={`${g.nAuto} of ${scored.length} in AUTO`} value={g.coverage * 100} fmt={(x) => `${x.toFixed(1)}%`} testId="kpi-coverage" />
            <Kpi
              label="AUTO accuracy"
              sub={g.nAuto ? `[${pct(g.auto.lo)} – ${pct(g.auto.hi)}] Wilson 95%` : "no items in AUTO"}
              value={g.nAuto ? g.auto.p * 100 : NaN}
              fmt={(x) => `${x.toFixed(1)}%`}
            />
            <Kpi label="Confident errors" sub="wrong picks that would run unreviewed" value={g.confidentErrors} fmt={(x) => String(Math.round(x))} tone={g.confidentErrors ? "bad" : undefined} testId="kpi-confident" />
            <Kpi label="Risk-weighted" sub={`DELETE picks cost ×${w}`} value={g.riskConfidentErrors} fmt={(x) => String(Math.round(x))} tone={g.riskConfidentErrors ? "bad" : undefined} />
            <div className="card col-span-2 p-3.5">
              <div className="flex items-center justify-between">
                <span className="eyebrow !text-[9.5px]">Selective accuracy vs coverage</span>
                <span className="mono text-[10.5px] text-muted">
                  AURC <span className="num text-text">{Number.isFinite(sel.aurc) ? sel.aurc.toFixed(3) : "—"}</span>
                </span>
              </div>
              <CoverageCurve curve={sel.curve} coverage={g.coverage} autoAcc={g.auto.p} />
            </div>
            <div className="card col-span-2 p-3.5">
              <div className="flex items-center justify-between">
                <span className="eyebrow !text-[9.5px]">Reliability · 10 bins</span>
                <span className="mono text-[10.5px] text-muted">
                  ECE <span className="num text-text">{Number.isFinite(rel.ece) ? rel.ece.toFixed(3) : "—"}</span>
                </span>
              </div>
              <Reliability bins={rel.bins} />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function Dot({ kind }: { kind: "ok" | "bad" | "hollow" | "ring" }) {
  return (
    <svg width="12" height="12" aria-hidden className="-mr-2.5">
      {kind === "ring" && <circle cx="6" cy="6" r="5" fill="none" stroke="var(--err)" strokeWidth="1.2" />}
      <circle cx="6" cy="6" r={kind === "ring" ? 2.5 : 3.5} fill={kind === "hollow" ? "none" : kind === "ok" ? "var(--fixed)" : "var(--err)"} stroke={kind === "hollow" ? "var(--muted)" : "none"} strokeWidth="1.3" />
    </svg>
  );
}

function Kpi({ label, sub, value, fmt, tone, testId }: { label: string; sub: string; value: number; fmt: (x: number) => string; tone?: "bad"; testId?: string }) {
  return (
    <div className="card p-3.5">
      <div className="eyebrow !text-[9.5px]">{label}</div>
      <Ticker value={value} format={fmt} className={`mt-1 block text-[26px] font-medium leading-none ${tone === "bad" ? "text-err" : "text-text"}`} testId={testId} />
      <div className="mono mt-1.5 text-[10.5px] leading-4 text-faint">{sub}</div>
    </div>
  );
}

/** Deterministic dodge layout: sort by confidence, stack each dot at the nearest free level. */
function dodge(xs: { x: number; key: string }[], r: number): Map<string, number> {
  const placed: { x: number; y: number }[] = [];
  const out = new Map<string, number>();
  const sorted = [...xs].sort((a, b) => a.x - b.x || (a.key < b.key ? -1 : 1));
  for (const d of sorted) {
    let level = 0;
    for (let k = 0; k < 200; k++) {
      const y = level === 0 ? 0 : (level % 2 ? -1 : 1) * Math.ceil(level / 2) * (2 * r + 1);
      if (!placed.some((p) => Math.abs(p.x - d.x) < 2 * r + 0.5 && Math.abs(p.y - y) < 2 * r + 0.5)) {
        placed.push({ x: d.x, y });
        out.set(d.key, y);
        break;
      }
      level++;
    }
  }
  return out;
}

function Strip({ scored, tau }: { scored: Scored[]; tau: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(700);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const H = 300;
  const m = 18;
  const r = W < 500 ? 3 : 4.2;
  const x = (c: number) => m + c * (W - 2 * m);
  const ok = scored.filter((s) => !s.error);
  const ys = useMemo(() => dodge(ok.map((s) => ({ x: x(s.confidence), key: s.id })), r), [ok, W, r]); // eslint-disable-line react-hooks/exhaustive-deps
  const [drag, setDrag] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const toTau = (clientX: number) => {
    const rect = svgRef.current!.getBoundingClientRect();
    setTau((clientX - rect.left - m) / (W - 2 * m));
  };
  const nAuto = ok.filter((s) => s.confidence >= tau).length;
  const tx = x(tau);
  const mid = H / 2 + 6;
  return (
    <div ref={ref} className="mt-2">
      <svg
        ref={svgRef}
        width={W}
        height={H}
        className="touch-none"
        onPointerDown={(e) => {
          (e.target as Element).setPointerCapture?.(e.pointerId);
          setDrag(true);
          toTau(e.clientX);
        }}
        onPointerMove={(e) => drag && toTau(e.clientX)}
        onPointerUp={() => setDrag(false)}
        data-testid="gate-strip"
        role="slider"
        aria-label="Confidence threshold"
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={tau}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" || e.key === "ArrowUp") setTau(tau + (e.shiftKey ? 0.1 : 0.01));
          if (e.key === "ArrowLeft" || e.key === "ArrowDown") setTau(tau - (e.shiftKey ? 0.1 : 0.01));
        }}
      >
        <rect x={tx} y={10} width={Math.max(0, x(1) - tx + m)} height={H - 34} fill="rgb(61 214 208 / 0.05)" />
        <line x1={m} x2={W - m} y1={H - 22} y2={H - 22} stroke="var(--line-2)" />
        {[0, 0.2, 0.4, 0.6, 0.8, 1].map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={H - 22} y2={H - 17} stroke="var(--line-2)" />
            <text x={x(t)} y={H - 5} textAnchor="middle" className="mono" fontSize={10} fill="var(--faint)">
              {t.toFixed(1)}
            </text>
          </g>
        ))}
        <text x={m} y={22} className="mono" fontSize={10} letterSpacing="0.12em" fill="var(--muted)">
          HUMAN · {ok.length - nAuto + (scored.length - ok.length)}
        </text>
        <text x={W - m} y={22} textAnchor="end" className="mono" fontSize={10} letterSpacing="0.12em" fill="var(--signal)">
          AUTO · {nAuto}
        </text>
        {ok.map((s) => {
          const cx = x(s.confidence);
          const cy = mid + (ys.get(s.id) ?? 0);
          const auto = s.confidence >= tau;
          const hollow = s.gold === NONE;
          const color = s.correct ? "var(--fixed)" : "var(--err)";
          return (
            <g key={s.id} opacity={auto ? 1 : 0.55}>
              {auto && !s.correct && <circle className="ring-pulse" cx={cx} cy={cy} r={5} fill="none" stroke="var(--err)" strokeWidth={1.2} />}
              <circle cx={cx} cy={cy} r={r} fill={hollow ? "var(--panel-2)" : color} stroke={hollow ? color : "none"} strokeWidth={1.4} data-testid="gate-dot">
                <title>{`${s.id} · ${s.correct ? "correct" : "wrong"} · confidence ${s.confidence.toFixed(3)}\n${s.query}`}</title>
              </circle>
            </g>
          );
        })}
        <motion.g initial={false} animate={{ x: tx }} transition={{ type: "spring", stiffness: 500, damping: 40 }}>
          <line x1={0} x2={0} y1={30} y2={H - 22} stroke="var(--signal)" strokeWidth={1.5} />
          <rect x={-22} y={28} width={44} height={18} rx={9} fill="var(--signal)" style={{ cursor: "ew-resize" }} />
          <text y={40.5} textAnchor="middle" className="mono" fontSize={10.5} fontWeight={600} fill="#031312" data-testid="tau-label">
            τ {tau.toFixed(2)}
          </text>
        </motion.g>
      </svg>
    </div>
  );
}

function CoverageCurve({ curve, coverage, autoAcc }: { curve: { coverage: number; accuracy: number }[]; coverage: number; autoAcc: number }) {
  const W = 480;
  const H = 150;
  const m = { l: 32, r: 10, t: 10, b: 22 };
  const x = (c: number) => m.l + c * (W - m.l - m.r);
  const y = (a: number) => m.t + (1 - a) * (H - m.t - m.b);
  const d = curve.map((p, i) => `${i ? "L" : "M"}${x(p.coverage).toFixed(1)},${y(p.accuracy).toFixed(1)}`).join("");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full" aria-hidden>
      {[0, 0.5, 1].map((t) => (
        <g key={t}>
          <line x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} stroke="var(--line)" />
          <text x={m.l - 6} y={y(t)} dy="0.34em" textAnchor="end" className="mono" fontSize={9.5} fill="var(--faint)">
            {t * 100}%
          </text>
        </g>
      ))}
      <text x={x(0)} y={H - 6} className="mono" fontSize={9.5} fill="var(--faint)">
        coverage 0
      </text>
      <text x={x(1)} y={H - 6} textAnchor="end" className="mono" fontSize={9.5} fill="var(--faint)">
        1
      </text>
      <path d={d} fill="none" stroke="var(--signal)" strokeWidth={1.6} />
      {coverage > 0 && Number.isFinite(autoAcc) && (
        <motion.g initial={false} animate={{ x: x(coverage), y: y(autoAcc) }} transition={{ type: "spring", stiffness: 400, damping: 34 }}>
          <circle r={4.5} fill="var(--bg)" stroke="var(--signal)" strokeWidth={2} />
        </motion.g>
      )}
    </svg>
  );
}

function Reliability({ bins }: { bins: { lo: number; hi: number; n: number; confidence: number; accuracy: number }[] }) {
  const W = 480;
  const H = 150;
  const m = { l: 32, r: 10, t: 10, b: 22 };
  const x = (c: number) => m.l + c * (W - m.l - m.r);
  const y = (a: number) => m.t + (1 - a) * (H - m.t - m.b);
  const maxN = Math.max(1, ...bins.map((b) => b.n));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full" aria-hidden>
      {[0, 0.5, 1].map((t) => (
        <line key={t} x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} stroke="var(--line)" />
      ))}
      <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} stroke="var(--muted)" strokeDasharray="3 3" />
      {bins.map((b) =>
        b.n ? (
          <g key={b.lo}>
            <rect x={x(b.lo) + 2} y={y(b.accuracy)} width={x(b.hi) - x(b.lo) - 4} height={y(0) - y(b.accuracy)} rx={2} fill="var(--signal)" opacity={0.25 + 0.6 * (b.n / maxN)} />
            <text x={(x(b.lo) + x(b.hi)) / 2} y={y(0) + 12} textAnchor="middle" className="mono" fontSize={8.5} fill="var(--faint)">
              {b.n}
            </text>
          </g>
        ) : null,
      )}
      <text x={m.l - 6} y={y(1)} dy="0.34em" textAnchor="end" className="mono" fontSize={9.5} fill="var(--faint)">
        acc 1
      </text>
      <text x={x(1)} y={H - 1} textAnchor="end" className="mono" fontSize={9} fill="var(--faint)">
        confidence → (bar labels: items per bin)
      </text>
    </svg>
  );
}
