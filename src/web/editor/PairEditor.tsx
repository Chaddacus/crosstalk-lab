import { AnimatePresence, motion } from "motion/react";
import { NONE } from "../../core/data/catalog.ts";
import type { OptionText } from "../../core/data/criteria.ts";
import { opsById } from "../data.ts";
import { useAnalysis } from "../analysis.ts";
import {
  clearSelection,
  currentVersion,
  dirtyOptions,
  effectiveText,
  revertDrafts,
  saveAndRerun,
  setDraft,
  useStore,
} from "../store.ts";
import { MethodBadge } from "../ui/MethodBadge.tsx";
import { StateGlyph } from "../ui/StateGlyph.tsx";
import { PairsList } from "./PairsList.tsx";
import { pairKey } from "../../core/eval/leakage.ts";
import { textsEqual } from "../../core/data/criteria.ts";

export function LeftRail() {
  const pair = useStore((s) => s.pair);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <AnimatePresence mode="wait" initial={false}>
        {pair ? (
          <motion.div
            key="editor"
            className="flex min-h-0 flex-1 flex-col"
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            transition={{ duration: 0.16 }}
          >
            <PairEditor a={pair[0]} b={pair[1]} />
          </motion.div>
        ) : (
          <motion.div
            key="pairs"
            className="flex min-h-0 flex-1 flex-col"
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 8 }}
            transition={{ duration: 0.16 }}
          >
            <PairsList />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function PairEditor({ a, b }: { a: string; b: string }) {
  const { leak } = useAnalysis();
  const drafts = useStore((s) => s.drafts);
  const active = useStore((s) => s.active);
  useStore((s) => s.currentId);
  const p = leak?.pairs.find((x) => x.key === pairKey(a, b));
  const dirty = dirtyOptions();
  const pairDirty = dirty.filter((d) => d === a || d === b);
  const otherDirty = dirty.length - pairDirty.length;
  void drafts;
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="pair-editor">
      <div className="border-b border-line px-4 pb-3 pt-3.5">
        <div className="flex items-center justify-between">
          <span className="eyebrow">Pair editor</span>
          <button className="btn btn-ghost h-6 px-1.5 text-[11px]" onClick={() => clearSelection()} aria-label="Close the pair editor">
            <kbd className="kbd">Esc</kbd>
          </button>
        </div>
        <div className="mono mt-2 text-[13px] leading-5 text-text" data-testid="pair-title">
          <span className="break-all">{a === NONE ? "NO MATCH" : a}</span>
          <span className="mx-1.5 text-signal">⇄</span>
          <span className="break-all">{b === NONE ? "NO MATCH" : b}</span>
        </div>
        <div className="mono mt-2 flex items-center gap-3 text-[11px] text-muted">
          {p ? (
            <>
              <StateGlyph state={p.state} withLabel />
              <span>
                leak <span className="num text-text">{p.mass.toFixed(2)}</span>
              </span>
              <span>
                <span className="num text-text">{p.n}</span> items
              </span>
              {p.errors > 0 && (
                <span>
                  <span className="num text-err">{p.errors}</span> wrong
                </span>
              )}
            </>
          ) : (
            <span className="text-faint">no measurable leak between these two</span>
          )}
        </div>
      </div>
      <div className="scroll-thin min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        <OptionCard id={a} />
        <OptionCard id={b} />
      </div>
      <div className="border-t border-line bg-panel px-3 py-3">
        {otherDirty > 0 && (
          <div className="mono mb-2 text-[10.5px] text-post">
            + {otherDirty} other edited option{otherDirty > 1 ? "s" : ""} will be saved too
          </div>
        )}
        <div className="flex items-center gap-2">
          <button
            className="btn btn-primary flex-1"
            disabled={!dirty.length || !!active}
            onClick={() => void saveAndRerun()}
            data-testid="save-rerun"
          >
            {active ? "Running…" : "Save & rerun dev"}
            <span className="kbd !border-black/20 !bg-black/10 !text-[#031312]/70">Ctrl S</span>
          </button>
          <button className="btn" disabled={!dirty.length || !!active} onClick={() => revertDrafts()} data-testid="revert">
            Revert
          </button>
        </div>
        <div className="mono mt-2 flex items-center gap-2 text-[10.5px] text-faint">
          <kbd className="kbd">[</kbd>
          <kbd className="kbd">]</kbd> previous / next pair
          <span className="mx-1">·</span>
          <kbd className="kbd">?</kbd> shortcuts
        </div>
      </div>
    </div>
  );
}

function OptionCard({ id }: { id: string }) {
  const s = useStore();
  const op = opsById.get(id);
  const cur = currentVersion(s);
  const t = effectiveText(id, s);
  const saved = cur?.texts[id];
  const dirty = !!s.drafts[id] && !textsEqual(s.drafts[id], saved);
  const isNone = id === NONE;
  const update = (patch: Partial<OptionText>) => setDraft(id, patch);
  const examples = t.examples ?? [];
  return (
    <section className="card relative p-3" data-testid="option-card" data-op={id}>
      <header className="flex items-start gap-2">
        {op ? <MethodBadge method={op.method} /> : <span className="mono rounded-[5px] border border-line-2 px-1.5 text-[10px] text-muted">OPTION</span>}
        <div className="min-w-0 flex-1">
          <div className="mono truncate text-[12.5px] font-medium text-text" title={id}>
            {isNone ? "none_of_these" : id}
          </div>
          <div className="mono truncate text-[10.5px] text-faint">{op ? op.shortPath : "the NO MATCH hub"}</div>
        </div>
        <AnimatePresence>
          {dirty && (
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              className="mt-1 h-2 w-2 shrink-0 rounded-full bg-post shadow-[0_0_8px_var(--post)]"
              title="Edited, not saved"
              data-testid="dirty-dot"
            />
          )}
        </AnimatePresence>
      </header>
      {op && (
        <div className="mt-2.5 rounded-md border border-dashed border-line-2 bg-bg/60 px-2.5 py-2">
          <div className="eyebrow !text-[9px]">Spec text · read only</div>
          {op.empty ? (
            <span className="mono mt-1 inline-block rounded border border-err/40 bg-err/10 px-1.5 py-0.5 text-[9.5px] font-semibold tracking-wider text-err" data-testid="empty-in-spec">
              EMPTY IN SPEC
            </span>
          ) : (
            <p className="mt-1 text-[11.5px] leading-[1.45] text-muted">{op.description}</p>
          )}
        </div>
      )}
      <Field label="what" hint="What this option is for" value={t.what ?? ""} rows={3} onChange={(v) => update({ what: v })} testId={`what-${id}`} />
      <Field label="not_for" hint="Look-alike requests that belong elsewhere" value={t.not_for ?? ""} rows={2} onChange={(v) => update({ not_for: v })} testId={`notfor-${id}`} />
      <Field
        label="examples"
        hint="One example request per line"
        value={examples.join("\n")}
        rows={2}
        onChange={(v) => update({ examples: v.split("\n") })}
        testId={`examples-${id}`}
      />
      {examples.filter((e) => e.trim()).length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {examples
            .filter((e) => e.trim())
            .map((e, i) => (
              <span key={i} className="max-w-full truncate rounded-full border border-line-2 bg-panel-3 px-2 py-0.5 text-[10.5px] text-muted">
                {e}
              </span>
            ))}
        </div>
      )}
    </section>
  );
}

function Field({ label, hint, value, rows, onChange, testId }: { label: string; hint: string; value: string; rows: number; onChange: (v: string) => void; testId: string }) {
  return (
    <label className="mt-2.5 block">
      <span className="flex items-baseline justify-between">
        <span className="mono text-[10.5px] text-signal/90">{label}</span>
        <span className="text-[10px] text-faint">{hint}</span>
      </span>
      <textarea className="field mt-1" rows={rows} value={value} onChange={(e) => onChange(e.target.value)} data-testid={testId} spellCheck={false} />
    </label>
  );
}
