/** Derived analysis of the displayed run and the "before" run. Memoized by object identity. */
import { useMemo } from "react";
import { accuracy, riskWeighted, scoreRun, totalLeak, type Scored } from "../core/eval/metrics.ts";
import { computeLeakage, type LeakageReport } from "../core/eval/leakage.ts";
import { diffRuns, type RunDiff } from "../core/eval/diff.ts";
import type { RunRecord } from "../core/run/runner.ts";
import { deleteOps, devItems } from "./data.ts";
import { mergedRun, useStore } from "./store.ts";

export interface Analysis {
  run: RunRecord | null;
  scored: Scored[];
  acc: ReturnType<typeof accuracy> | null;
  risk: ReturnType<typeof riskWeighted> | null;
  leak: LeakageReport | null;
  totalLeak: number;
  before: RunRecord | null;
  beforeScored: Scored[] | null;
  beforeAcc: ReturnType<typeof accuracy> | null;
  beforeLeak: LeakageReport | null;
  diff: RunDiff | null;
}

export function useAnalysis(): Analysis {
  const runs = useStore((s) => s.runs);
  const active = useStore((s) => s.active);
  const viewId = useStore((s) => s.viewId);
  const backend = useStore((s) => s.backend);
  const versions = useStore((s) => s.versions);
  const health = useStore((s) => s.health);
  const compareKey = useStore((s) => s.compareKey);
  const riskWeight = useStore((s) => s.riskWeight);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useMemo(() => mergedRun(useStore.getState()), [runs, active, viewId, backend, versions, health]);
  const before = compareKey ? (runs[compareKey] ?? null) : null;
  const base = useMemo(() => {
    if (!run) return { scored: [] as Scored[], acc: null, leak: null, totalLeak: NaN };
    const scored = scoreRun(devItems, run);
    return { scored, acc: accuracy(scored), leak: computeLeakage(devItems, run), totalLeak: totalLeak(scored) };
  }, [run]);
  const risk = useMemo(() => (base.scored.length ? riskWeighted(base.scored, deleteOps, riskWeight) : null), [base.scored, riskWeight]);
  const prev = useMemo(() => {
    if (!before) return { beforeScored: null, beforeAcc: null, beforeLeak: null };
    const beforeScored = scoreRun(devItems, before);
    return { beforeScored, beforeAcc: accuracy(beforeScored), beforeLeak: computeLeakage(devItems, before) };
  }, [before]);
  const diff = useMemo(() => (prev.beforeScored && base.scored.length ? diffRuns(prev.beforeScored, base.scored) : null), [prev.beforeScored, base.scored]);
  return { run, ...base, risk, before, ...prev, diff };
}
