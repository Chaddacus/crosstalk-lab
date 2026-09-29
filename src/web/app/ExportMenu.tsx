import { AnimatePresence, motion } from "motion/react";
import { useCallback } from "react";
import { exportCriteria, exportRegressions, exportRun } from "../../core/eval/export.ts";
import { runIsFinal, useAnalysis } from "../analysis.ts";
import { modelFor, toast, useStore, viewVersion } from "../store.ts";
import { download } from "../lib/download.ts";
import { useClickOutside } from "../lib/hooks.ts";

export function useExports() {
  const { run, diff } = useAnalysis();
  const backend = useStore((s) => s.backend);
  const v = useStore((s) => viewVersion(s));
  const active = useStore((s) => s.active);
  const ready = !!v && runIsFinal(run, active);
  return {
    ready,
    criteria: () => {
      if (!v) return;
      download(exportCriteria(v.criteria, v.id, modelFor(backend)));
    },
    regressions: () => {
      if (!v || !run) return;
      const fixed = (diff?.flipped ?? []).filter((f) => f.status === "fixed").map((f) => ({ id: f.id, query: f.query, gold: f.gold }));
      download(exportRegressions({ version: v.id, criteria: v.criteria, fixed, backend: run.backend, model: run.model }));
      if (!fixed.length) toast("No item flipped to fixed in this version: the file has a single todo case.");
    },
    run: () => {
      if (run && run.runHash) download(exportRun(run));
    },
  };
}

/**
 * Export menu. `variant="more"` is the compact "⋯" menu used on narrow top bars: the same exports plus the
 * keyboard shortcuts, so nothing is lost when the bar collapses.
 */
export function ExportMenu({ variant = "button" }: { variant?: "button" | "more" }) {
  const open = useStore((s) => (variant === "more" ? s.moreOpen : s.exportOpen));
  const key = variant === "more" ? "moreOpen" : "exportOpen";
  const close = useCallback(() => useStore.setState({ [key]: false }), [key]);
  const ref = useClickOutside(open, close);
  const ex = useExports();
  const wait = ex.ready ? undefined : "Available when the run has finished";
  return (
    <div className="relative" ref={ref}>
      {variant === "more" ? (
        <button
          className="btn btn-ghost h-9 w-9 px-0"
          onClick={() => useStore.setState({ moreOpen: !open })}
          aria-expanded={open}
          aria-haspopup="menu"
          aria-label="More: exports and keyboard shortcuts"
          data-testid="more-button"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
            <circle cx="3.5" cy="8" r="1.4" fill="currentColor" />
            <circle cx="8" cy="8" r="1.4" fill="currentColor" />
            <circle cx="12.5" cy="8" r="1.4" fill="currentColor" />
          </svg>
        </button>
      ) : (
        <button className="btn h-8" onClick={() => useStore.setState({ exportOpen: !open })} aria-expanded={open} aria-haspopup="menu" data-testid="export-button">
          Export
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
            <path d="M2 3.5 L5 6.5 L8 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      )}
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.12 }}
            className="absolute right-0 top-10 z-40 w-72 max-w-[calc(100vw-24px)] overflow-hidden rounded-xl border border-line-2 bg-panel-2 p-1 shadow-[0_20px_60px_-15px_rgb(0_0_0/0.9)]"
            onKeyDown={(e) => e.key === "Escape" && close()}
          >
            <Item title="Criteria JSON" sub="The Choice criteria map, ready for a /v1/systemone request" onClick={ex.criteria} disabled={!ex.ready} hint={wait} testId="export-criteria" close={close} />
            <Item title="Regression tests" sub="A Vitest file with one case per item that flipped to fixed" onClick={ex.regressions} disabled={!ex.ready} hint={wait} testId="export-regressions" close={close} />
            <Item title="Run JSON" sub="Every result of the displayed dev run" onClick={ex.run} disabled={!ex.ready} hint={wait} testId="export-run" close={close} />
            {variant === "more" && (
              <>
                <div className="my-1 h-px bg-line" />
                <Item title="Keyboard shortcuts" sub="Save, previous and next pair, tabs" onClick={() => useStore.setState({ shortcuts: true })} disabled={false} testId="more-help" close={close} />
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Item({ title, sub, onClick, disabled, hint, testId, close }: { title: string; sub: string; onClick: () => void; disabled: boolean; hint?: string; testId: string; close: () => void }) {
  return (
    <button
      role="menuitem"
      className="block min-h-11 w-full rounded-lg px-3 py-2 text-left transition-colors hover:bg-panel-3 disabled:opacity-40"
      onClick={() => {
        onClick();
        close();
      }}
      disabled={disabled}
      title={disabled ? hint : undefined}
      data-testid={testId}
    >
      <div className="text-[12.5px] text-text">{title}</div>
      <div className="text-[11px] leading-4 text-muted">{sub}</div>
    </button>
  );
}
