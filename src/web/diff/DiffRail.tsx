import { motion } from "motion/react";
import { NONE } from "../../core/data/catalog.ts";
import type { Interval } from "../../core/eval/metrics.ts";
import { useAnalysis } from "../analysis.ts";
import { retryFailed, setRiskWeight, useStore, viewVersion } from "../store.ts";
import { codeLabel, summarizeFailures } from "../lib/errors.ts";
import { Ticker } from "../ui/Ticker.tsx";
import { int, pct, plural, secs, usd } from "../lib/format.ts";

export function DiffRail() {
  const { run, acc, beforeAcc, diff, risk, before, totalLeak } = useAnalysis();
  const active = useStore((s) => s.active);
  const riskWeight = useStore((s) => s.riskWeight);
  const v = useStore((s) => viewVersion(s));
  const running = !!active && active.split === "dev";
  const n = run?.results.length ?? 0;
  const delta = acc && beforeAcc ? acc.all.p - beforeAcc.all.p : NaN;
  const finished = !running && run && run.runHash ? run : null;
  const failures = !running && run && run.errors > 0 ? summarizeFailures(run.results) : null;
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="diff-rail">
      <div className="px-4 pb-2 pt-3.5">
        <div className="flex items-center justify-between">
          <span className="eyebrow">Since last run</span>
          <span className="mono text-[10.5px] text-faint">
            {before ? (
              <>
                {before.criteriaVersion ?? "prev"} → {v?.id}
              </>
            ) : (
              <>baseline · {v?.id ?? "v0"}</>
            )}
          </span>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 px-3">
        <Counter label="Fixed" value={diff ? diff.fixed : NaN} color="var(--fixed)" sign="+" testId="count-fixed" />
        <Counter label="Broke" value={diff ? diff.broke : NaN} color="var(--broke)" sign="−" testId="count-broke" />
        <Counter label="Same" value={diff ? diff.unchanged : NaN} color="var(--muted)" testId="count-unchanged" />
      </div>
      <div className="mono px-4 pt-1.5 text-[10.5px] leading-[1.45]" data-testid="run-scope">
        {failures ? (
          <div className="rounded-lg border border-err/40 bg-err/[0.07] px-2.5 py-2 text-muted" data-testid="failed-note">
            <span className="text-err">
              {failures.failed} of {n} failed · {codeLabel(failures.codes[0]!.code)}
            </span>
            <span className="text-faint"> · not counted as right, wrong or same</span>
            <p className="mt-1 font-sans text-[11.5px] leading-[1.45] text-muted">{failures.sentence}</p>
            {!active && (
              <button className="btn mt-2 h-8 w-full text-[11.5px]" onClick={() => void retryFailed()} data-testid="retry-failed">
                Retry {failures.failed} failed {plural(failures.failed, "item")}
              </button>
            )}
          </div>
        ) : !diff && run ? (
          <span className="text-faint">{running ? "running…" : `baseline: nothing to compare yet · ${n} scored`}</span>
        ) : null}
      </div>

      <div className="scroll-thin mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto px-3 pb-3">
        <section className="card p-3" data-testid="accuracy-card">
          <div className="flex items-baseline justify-between">
            <span className="flex items-center gap-2">
              <span className="eyebrow !text-[9.5px]">Dev top-1 accuracy</span>
              {acc && acc.errors > 0 && (
                <span className="mono rounded border border-err/50 bg-err/10 px-1 text-[9px] font-semibold tracking-wider text-err" data-testid="partial-badge">
                  PARTIAL · {acc.all.n} of {acc.n} scored
                </span>
              )}
            </span>
            {Number.isFinite(delta) && (
              <motion.span
                key={delta.toFixed(4)}
                initial={{ opacity: 0, y: -3 }}
                animate={{ opacity: 1, y: 0 }}
                className={`num text-[11px] ${delta > 0 ? "text-fixed" : delta < 0 ? "text-broke" : "text-muted"}`}
                data-testid="acc-delta"
              >
                {delta > 0 ? "▲" : delta < 0 ? "▼" : "■"} {delta >= 0 ? "+" : "−"}
                {Math.abs(delta * 100).toFixed(1)} pts
              </motion.span>
            )}
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <Ticker value={acc ? acc.all.p * 100 : NaN} format={(x) => x.toFixed(1)} className="text-[30px] font-medium leading-none tracking-tight text-text" testId="acc-value" />
            <span className="num text-[14px] text-muted">%</span>
            <span className="num ml-auto text-[11px] text-muted" data-testid="acc-interval">
              {acc && acc.all.n > 0 ? `[${pct(acc.all.lo)} – ${pct(acc.all.hi)}]` : ""}
            </span>
          </div>
          {acc && acc.all.n > 0 && <IntervalBar iv={acc.all} before={beforeAcc?.all} />}
          <div className="mt-2.5 space-y-1 text-[11.5px]">
            <Row label="match" iv={acc?.match} />
            <Row label="no match" iv={acc?.noMatch} />
          </div>
          <div className="mono mt-2 text-[10px] text-faint">Wilson 95% interval · n = {acc?.all.n ?? "—"}</div>
        </section>

        <section className="card p-3">
          <div className="flex items-baseline justify-between">
            <span className="eyebrow !text-[9.5px]">Risk-weighted error</span>
            <label className="mono flex items-center gap-1 text-[10.5px] text-muted">
              DELETE ×
              <input
                type="number"
                min={1}
                max={100}
                value={riskWeight}
                onChange={(e) => setRiskWeight(Number(e.target.value))}
                className="num w-10 rounded border border-line bg-bg px-1 py-0.5 text-right text-[11px] text-text"
                aria-label="Cost of a wrong DELETE pick"
              />
            </label>
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <Ticker value={risk ? risk.per100 : NaN} format={(x) => x.toFixed(1)} className="text-[22px] font-medium leading-none text-text" testId="risk-value" />
            <span className="text-[11px] text-muted">per 100 items</span>
          </div>
          <div className="mono mt-1.5 text-[10.5px] text-faint">
            {risk ? (
              <>
                {risk.wrong} wrong picks, <span className={risk.wrongDelete ? "text-delete" : ""}>{risk.wrongDelete} into DELETE</span>
              </>
            ) : (
              "—"
            )}
          </div>
        </section>

        <section className="card grid grid-cols-3 gap-2 p-3">
          <Mini label={finished?.costSource === "estimated" || !finished ? "tokens est." : "tokens"} value={finished ? int(finished.inputTokens) : "—"} />
          <Mini label={finished?.costSource === "estimated" || !finished ? "cost est." : "cost"} value={finished ? usd(finished.costUsd) : "—"} testId="run-cost" />
          <Mini label="wall time" value={finished ? secs(finished.wallMs) : running ? "…" : "—"} testId="wall-time" />
          <div className="col-span-3 flex items-center justify-between border-t border-line pt-2 text-[10.5px]">
            <span className="mono text-faint">
              total leak <span className="num text-muted">{Number.isFinite(totalLeak) ? totalLeak.toFixed(1) : "—"}</span>
            </span>
            <span className="mono text-faint" title="sha256 of this run's results" data-testid="run-hash">
              run {finished ? finished.runHash.slice(0, 10) : "…"}
            </span>
          </div>
        </section>

        <section>
          <div className="flex items-center justify-between px-1 pb-1.5">
            <span className="eyebrow !text-[9.5px]">Flipped items</span>
            <span className="mono text-[10px] text-faint">{diff ? diff.flipped.length : 0}</span>
          </div>
          {diff && diff.flipped.length > 0 ? (
            <ul className="space-y-1.5" data-testid="flipped-list">
              {diff.flipped.slice(0, 60).map((f) => (
                <li key={f.id}>
                  <button
                    className="w-full rounded-lg border border-line bg-panel-2 px-2.5 py-2 text-left transition-colors hover:border-line-2"
                    onClick={() => useStore.setState({ itemId: f.id, tab: "items" })}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`mono rounded px-1 text-[9px] font-semibold tracking-wider ${f.status === "fixed" ? "bg-fixed/15 text-fixed" : "bg-broke/15 text-broke"}`}
                      >
                        {f.status.toUpperCase()}
                      </span>
                      <span className="truncate text-[11.5px] text-text">{f.query}</span>
                    </div>
                    <div className="mono mt-1 truncate text-[10px] text-muted">
                      gold {short(f.gold)} · <span className="text-faint">{short(f.before.chosen)}</span> → <span className={f.status === "fixed" ? "text-fixed" : "text-broke"}>{short(f.after.chosen)}</span>
                    </div>
                    <div className="mt-1.5 grid grid-cols-[34px_1fr_34px] items-center gap-1.5">
                      <span className="num text-[9.5px] text-faint">{f.before.pGold.toFixed(2)}</span>
                      <span className="relative h-1.5 rounded-full bg-line">
                        <span className="absolute inset-y-0 left-0 rounded-full bg-bgchord/60" style={{ width: `${f.before.pGold * 100}%` }} />
                        <span
                          className="absolute inset-y-0 left-0 rounded-full"
                          style={{ width: `${f.after.pGold * 100}%`, background: f.status === "fixed" ? "var(--fixed)" : "var(--broke)", opacity: 0.9, height: "100%", top: 0 }}
                        />
                      </span>
                      <span className="num text-right text-[9.5px] text-text">{f.after.pGold.toFixed(2)}</span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-[11.5px] text-faint">
              {before ? "No item changed from right to wrong or back." : "Edit a pair and save to see what flips."}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

function short(o: string | null) {
  if (!o) return "error";
  return o === NONE ? "NO MATCH" : o;
}

function Counter({ label, value, color, sign, testId }: { label: string; value: number; color: string; sign?: string; testId: string }) {
  return (
    <div className="rounded-xl border border-line bg-panel-2 px-2.5 pb-2 pt-2">
      <div className="eyebrow !text-[9px]" style={{ color }}>
        {label}
      </div>
      <div className="mt-0.5 flex items-baseline">
        {sign && Number.isFinite(value) && value > 0 && (
          <span className="num text-[16px]" style={{ color }}>
            {sign}
          </span>
        )}
        <Ticker value={value} className="text-[24px] font-medium leading-tight" testId={testId} />
      </div>
    </div>
  );
}

function Row({ label, iv }: { label: string; iv?: Interval }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted">{label}</span>
      <span className="num text-text">
        {iv ? pct(iv.p) : "—"} <span className="text-faint">{iv ? `${iv.k}/${iv.n}` : ""}</span>
      </span>
    </div>
  );
}

function Mini({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div>
      <div className="eyebrow !text-[9px]">{label}</div>
      <div className="num mt-0.5 truncate text-[12.5px] text-text" data-testid={testId}>
        {value}
      </div>
    </div>
  );
}

/** Point and 95% interval on a 0–100% track; the previous run is a ghost. */
function IntervalBar({ iv, before }: { iv: Interval; before?: Interval }) {
  return (
    <div className="relative mt-3 h-4" aria-hidden>
      <div className="absolute inset-x-0 top-1/2 h-px bg-line-2" />
      {[0, 0.25, 0.5, 0.75, 1].map((t) => (
        <div key={t} className="absolute top-[5px] h-1.5 w-px bg-line-2" style={{ left: `${t * 100}%` }} />
      ))}
      {before && (
        <>
          <div className="absolute top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-bgchord/40" style={{ left: `${before.lo * 100}%`, width: `${(before.hi - before.lo) * 100}%` }} />
          <div className="absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-faint bg-bg" style={{ left: `${before.p * 100}%` }} />
        </>
      )}
      <motion.div
        className="absolute top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-signal/60"
        initial={false}
        animate={{ left: `${iv.lo * 100}%`, width: `${(iv.hi - iv.lo) * 100}%` }}
        transition={{ type: "spring", stiffness: 140, damping: 20 }}
      />
      <motion.div
        className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-signal shadow-[0_0_10px_var(--signal)]"
        initial={false}
        animate={{ left: `${iv.p * 100}%` }}
        transition={{ type: "spring", stiffness: 140, damping: 20 }}
      />
    </div>
  );
}
