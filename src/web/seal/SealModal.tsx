import { AnimatePresence, motion } from "motion/react";
import { useMemo, useRef } from "react";
import { accuracy, riskWeighted, scoreRun, type Interval } from "../../core/eval/metrics.ts";
import { loadSealedSplit, recordPeek, type LedgerStore } from "../../core/eval/seal.ts";
import type { RunRecord } from "../../core/run/runner.ts";
import { cliLedgerRows, deleteOps, devItems, manifest, TEST_URL } from "../data.ts";
import { currentVersion, devRunFor, startRun, toast, useStore, versionByHash, type State } from "../store.ts";
import { saveLedger } from "../lib/storage.ts";
import { pct } from "../lib/format.ts";
import { useDialog } from "../ui/dialog.ts";
import { Padlock } from "./Padlock.tsx";

const browserLedger: LedgerStore = {
  read: async () => useStore.getState().seal.ledger,
  append: async (row) => {
    const rows = [...useStore.getState().seal.ledger, row];
    const kept = saveLedger(rows);
    useStore.setState((s) => ({ seal: { ...s.seal, ledger: rows, persisted: kept } }));
    if (!kept) toast("Browser storage is blocked: this peek is not saved. It is counted for this page only.", "error");
  },
};

/** Fetch test.jsonl (only now), check its sha256 against the manifest, run it once, record one peek. */
export async function unsealAndRun() {
  const s = useStore.getState();
  const v = currentVersion(s);
  if (!v || s.active) return;
  useStore.setState((st) => ({ seal: { ...st.seal, status: "running", error: undefined } }));
  try {
    const { items, sha256 } = await loadSealedSplit({
      unseal: true,
      manifest,
      read: async () => {
        const res = await fetch(TEST_URL, { cache: "no-store" });
        if (!res.ok) throw new Error(`could not fetch the test split (HTTP ${res.status})`);
        return res.arrayBuffer();
      },
    });
    useStore.setState((st) => ({ seal: { ...st.seal, testItems: items } }));
    const record = await startRun(v, { split: "test", items, baseKey: null });
    const scored = scoreRun(items, record);
    const acc = accuracy(scored);
    const risk = riskWeighted(scored, deleteOps, useStore.getState().riskWeight);
    await recordPeek(browserLedger, {
      at: new Date().toISOString(),
      split: "test",
      testSha256: sha256,
      criteriaHash: v.hash,
      criteriaVersion: v.id,
      backend: record.backend,
      model: record.model,
      n: acc.n,
      accuracy: acc.all.p,
      lo: acc.all.lo,
      hi: acc.all.hi,
      matchAccuracy: acc.match.p,
      noMatchAccuracy: acc.noMatch.p,
      riskPer100: risk.per100,
      errors: acc.errors,
      where: "browser",
    });
    useStore.setState((st) => ({ seal: { ...st.seal, status: "done", testRun: record } }));
  } catch (e) {
    useStore.setState((st) => ({ seal: { ...st.seal, status: "error", error: (e as Error).message } }));
  }
}

/**
 * Dev next to test, never mixed: the dev column is the stored dev run with the SAME criteria hash, backend and
 * model as the test run. Each column is labeled with its own version. When the current criteria differ from
 * the ones the test ran on, the result is marked stale.
 */
export function sealComparison(s: State) {
  const test = s.seal.testRun;
  if (!test || !s.seal.testItems) return null;
  const testVersion = versionByHash(test.criteriaHash, s);
  const cur = currentVersion(s);
  const dev: RunRecord | null = devRunFor(test, s);
  return {
    test,
    testLabel: test.criteriaVersion ?? testVersion?.id ?? test.criteriaHash.slice(0, 8),
    dev,
    stale: !!cur && cur.hash !== test.criteriaHash,
    currentLabel: cur?.id ?? "—",
  };
}

export function SealModal() {
  const open = useStore((s) => s.sealOpen);
  return <AnimatePresence>{open && <Modal key="seal" />}</AnimatePresence>;
}

function Modal() {
  const seal = useStore((s) => s.seal);
  const riskWeight = useStore((s) => s.riskWeight);
  const active = useStore((s) => s.active);
  const cur = useStore((s) => currentVersion(s));
  const runs = useStore((s) => s.runs);
  const versions = useStore((s) => s.versions);
  // computed from the store snapshot (a selector returning a new object each time would loop)
  const cmp = useMemo(() => sealComparison(useStore.getState()), [seal, runs, versions, cur]);
  const ref = useRef<HTMLDivElement>(null);
  const t = manifest.splits.test!;
  const close = () => useStore.setState({ sealOpen: false });
  useDialog(true, ref, close);
  const test = cmp && seal.testItems ? scoreRun(seal.testItems, cmp.test) : null;
  const testAcc = test ? accuracy(test) : null;
  const testRisk = test ? riskWeighted(test, deleteOps, riskWeight) : null;
  const dev = cmp?.dev ? scoreRun(devItems, cmp.dev) : null;
  const devAcc = dev ? accuracy(dev) : null;
  const devRisk = dev ? riskWeighted(dev, deleteOps, riskWeight) : null;
  const running = seal.status === "running";
  const opened = seal.status === "done" || running;
  const peeks = seal.ledger.length;
  return (
    <motion.div className="fixed inset-0 z-50 flex items-center justify-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={close} />
      <motion.div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="seal-title"
        tabIndex={-1}
        className="relative max-h-[92dvh] w-full max-w-[640px] overflow-y-auto rounded-2xl border border-line-2 bg-panel shadow-[0_40px_120px_-20px_rgb(0_0_0/0.9)] outline-none"
        initial={{ y: 16, scale: 0.98 }}
        animate={{ y: 0, scale: 1 }}
        exit={{ y: 16, scale: 0.98 }}
        transition={{ type: "spring", stiffness: 300, damping: 28 }}
        data-testid="seal-modal"
      >
        <div className="flex items-start gap-4 border-b border-line p-5">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-line-2 bg-panel-2">
            <Padlock open={opened} size={26} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="seal-title" className="text-[16px] font-semibold text-text">
              Sealed test set
            </h2>
            <p className="mt-1 text-[12.5px] leading-[1.5] text-muted">
              The test split was written and hashed before any criteria, mock tuning or UI code (see the git history). Running it does not change your criteria.
              It records one peek.
            </p>
          </div>
          <button className="btn btn-ghost h-8 px-2" onClick={close} aria-label="Close the seal" data-autofocus data-testid="seal-close">
            <kbd className="kbd">Esc</kbd>
          </button>
        </div>

        <div className="grid grid-cols-3 gap-3 border-b border-line p-5">
          <Fact label="items" value={String(t.count)} sub={`${t.match} match · ${t.noMatch} no match`} />
          <Fact label="peeks so far" value={String(peeks)} sub={`this browser · CLI ledger ${cliLedgerRows.length}`} testId="modal-peeks" />
          <Fact label="current criteria" value={cur?.id ?? "—"} sub={cur ? `sha256:${cur.hash.slice(0, 8)}…` : ""} />
          <div className="col-span-3">
            <div className="eyebrow !text-[9.5px]">manifest sha256 · test.jsonl</div>
            <div className="mono mt-1 break-all rounded-md border border-line bg-bg px-2.5 py-1.5 text-[11px] text-muted">{t.sha256}</div>
          </div>
        </div>

        {seal.status === "error" && <div className="mono border-b border-line bg-err/10 px-5 py-3 text-[12px] text-err">Refused: {seal.error}</div>}

        <AnimatePresence initial={false}>
          {cmp && testAcc && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} className="overflow-hidden border-b border-line" data-testid="seal-result">
              <div className="p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="eyebrow">
                    Dev vs test · criteria {cmp.testLabel} · {cmp.test.backend === "http" ? cmp.test.model : cmp.test.backend}
                  </div>
                  {cmp.stale && (
                    <span className="mono rounded border border-post/50 bg-post/10 px-1.5 py-0.5 text-[10px] text-post" data-testid="seal-stale">
                      test result is for {cmp.testLabel}; current is {cmp.currentLabel}
                    </span>
                  )}
                </div>
                <table className="mt-3 w-full text-[12.5px]">
                  <thead>
                    <tr className="text-left text-muted">
                      <th className="pb-2 font-normal" />
                      <th className="pb-2 font-normal" data-testid="seal-dev-col">
                        dev · {cmp.testLabel} (tuned on)
                      </th>
                      <th className="pb-2 font-normal" data-testid="seal-test-col">
                        test · {cmp.testLabel} (sealed)
                      </th>
                    </tr>
                  </thead>
                  <tbody className="num">
                    <Tr label="top-1 accuracy" a={devAcc?.all} b={testAcc.all} testId="test-accuracy" />
                    <Tr label="match" a={devAcc?.match} b={testAcc.match} />
                    <Tr label="no match" a={devAcc?.noMatch} b={testAcc.noMatch} />
                    <tr className="border-t border-line">
                      <td className="py-2 font-sans text-muted">risk-weighted error / 100</td>
                      <td className="py-2 text-text">{devRisk ? devRisk.per100.toFixed(1) : "—"}</td>
                      <td className="py-2 text-text">{testRisk ? testRisk.per100.toFixed(1) : "—"}</td>
                    </tr>
                  </tbody>
                </table>
                {!cmp.dev && <p className="mono mt-2 text-[11px] text-faint">No dev run of {cmp.testLabel} on this backend is loaded, so the dev column is empty.</p>}
                <p className="mt-3 text-[11.5px] leading-[1.5] text-faint">
                  {cmp.test.backend === "mock" ? "MOCK · lexical stand-in, not Jev. These numbers say nothing about any model. " : ""}
                  {seal.persisted ? (
                    <>
                      The ledger for this page lives in this browser (localStorage). The CLI ledger, <span className="mono">ledger/test_runs.jsonl</span>, is the record of
                      truth.
                    </>
                  ) : (
                    <span className="text-post" data-testid="seal-not-saved">
                      Browser storage is blocked: this peek is not saved and is counted for this page only. The CLI ledger, ledger/test_runs.jsonl, is the record of
                      truth.
                    </span>
                  )}
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {peeks > 0 && (
          <div className="border-b border-line px-5 py-4">
            <div className="eyebrow !text-[9.5px]">Peek ledger · this browser</div>
            <ul className="mono mt-2 space-y-1 text-[11px] text-muted" data-testid="ledger">
              {seal.ledger
                .slice(-5)
                .reverse()
                .map((r) => (
                  <li key={r.peek + r.at} className="flex justify-between gap-3">
                    <span>
                      #{r.peek} · {r.criteriaVersion ?? r.criteriaHash.slice(0, 8)} · {r.backend}
                    </span>
                    <span className="text-text">{pct(r.accuracy)}</span>
                    <span className="text-faint">{new Date(r.at).toLocaleString()}</span>
                  </li>
                ))}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 p-5">
          <p className="max-w-[330px] text-[11px] leading-[1.5] text-faint">
            “Sealed” means the hash was committed first and every look is counted. It is not secrecy: anyone can read the file.
          </p>
          <div className="flex gap-2">
            <button className="btn" onClick={close}>
              {seal.status === "done" ? "Close" : "Cancel"}
            </button>
            <button
              className="btn border-post/60 bg-post/15 text-post hover:!bg-post/25"
              onClick={() => void unsealAndRun()}
              disabled={running || !!active}
              data-testid="unseal"
            >
              <Padlock open={opened} size={13} color="var(--post)" />
              {running ? "Running test…" : seal.status === "done" ? `Run ${cur?.id ?? ""} again (+1 peek)` : `Unseal and run ${cur?.id ?? ""} once`}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

function Fact({ label, value, sub, testId }: { label: string; value: string; sub: string; testId?: string }) {
  return (
    <div>
      <div className="eyebrow !text-[9.5px]">{label}</div>
      <div className="num mt-0.5 text-[20px] text-text" data-testid={testId}>
        {value}
      </div>
      <div className="mono text-[10.5px] text-faint">{sub}</div>
    </div>
  );
}

function Tr({ label, a, b, testId }: { label: string; a?: Interval; b: Interval; testId?: string }) {
  return (
    <tr className="border-t border-line">
      <td className="py-2 font-sans text-muted">{label}</td>
      <td className="py-2 text-text">
        {a ? (
          <>
            {pct(a.p)} <span className="text-[10.5px] text-faint">[{pct(a.lo, 0)}–{pct(a.hi, 0)}]</span>
          </>
        ) : (
          "—"
        )}
      </td>
      <td className="py-2 text-text" data-testid={testId}>
        {pct(b.p)} <span className="text-[10.5px] text-faint">[{pct(b.lo, 0)}–{pct(b.hi, 0)}]</span>
      </td>
    </tr>
  );
}
