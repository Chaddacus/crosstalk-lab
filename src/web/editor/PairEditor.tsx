import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { NONE } from "../../core/data/catalog.ts";
import type { OptionText } from "../../core/data/criteria.ts";
import { opsById } from "../data.ts";
import { useAnalysis } from "../analysis.ts";
import {
  clearSelection,
  currentVersion,
  dirtyOptions,
  isViewingOld,
  restoreVersion,
  revertDrafts,
  saveAndRerun,
  setDraft,
  useStore,
  viewVersion,
  viewVersionById,
} from "../store.ts";
import { MethodBadge } from "../ui/MethodBadge.tsx";
import { StateGlyph } from "../ui/StateGlyph.tsx";
import { PairsList } from "./PairsList.tsx";
import { pairKey } from "../../core/eval/leakage.ts";
import { textsEqual } from "../../core/data/criteria.ts";
import { DEMO, DEMO_KEY } from "../demo.ts";
import { plural } from "../lib/format.ts";

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

/** The text an option shows: the viewed version's (read-only) when viewing an older one, else draft or current. */
function useOptionText(id: string): { t: OptionText; saved: OptionText | undefined; draft: OptionText | undefined; readOnly: boolean } {
  const draft = useStore((s) => s.drafts[id]);
  const saved = useStore((s) => currentVersion(s)?.texts[id]);
  const viewed = useStore((s) => viewVersion(s)?.texts[id]);
  const readOnly = useStore((s) => isViewingOld(s));
  if (readOnly) return { t: viewed ?? {}, saved: viewed, draft: undefined, readOnly };
  return { t: draft ?? saved ?? {}, saved, draft, readOnly };
}

export function PairEditor({ a, b, phone = false }: { a: string; b: string; phone?: boolean }) {
  const { leak } = useAnalysis();
  const drafts = useStore((s) => s.drafts);
  const active = useStore((s) => s.active);
  const viewId = useStore((s) => s.viewId);
  const currentId = useStore((s) => s.currentId);
  const readOnly = viewId !== currentId;
  const [side, setSide] = useState<"a" | "b">("a");
  const p = leak?.pairs.find((x) => x.key === pairKey(a, b));
  const dirty = dirtyOptions();
  const pairDirty = dirty.filter((d) => d === a || d === b);
  const otherDirty = dirty.length - pairDirty.length;
  const cur = useStore((s) => currentVersion(s));
  const isDemo = pairKey(a, b) === DEMO_KEY;
  // hidden once the demo text is in the drafts or already saved in the current version
  const demoFilled =
    isDemo && Object.entries(DEMO.edits).every(([op, t]) => Object.entries(t).every(([k, v]) => ((drafts[op] ?? cur?.texts[op]) as Record<string, unknown> | undefined)?.[k] === v));
  const fillDemo = () => {
    for (const [op, t] of Object.entries(DEMO.edits)) setDraft(op, t);
  };
  const name = (o: string) => (o === NONE ? "NO MATCH" : o);
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="pair-editor">
      <div className="border-b border-line px-4 pb-3 pt-3.5">
        <div className="flex items-center justify-between">
          <h2 className="eyebrow">Pair editor</h2>
          <button className="btn btn-ghost h-8 px-2 text-[11px]" onClick={() => clearSelection()} aria-label="Close the pair editor" data-testid="pair-close">
            <kbd className="kbd hidden md:inline">Esc</kbd>
            <span className="md:hidden">Close</span>
          </button>
        </div>
        <div className="mono mt-2 text-[13px] leading-5 text-text" data-testid="pair-title" title={`${name(a)} ⇄ ${name(b)}`}>
          <span className="block truncate">{name(a)}</span>
          <span className="block truncate">
            <span className="mr-1.5 text-signal">⇄</span>
            {name(b)}
          </span>
        </div>
        <div className="mono mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted" data-testid="pair-stats">
          {p ? (
            <>
              <StateGlyph state={p.state} withLabel />
              <span>
                leaked mass <span className="num text-text">{p.mass.toFixed(2)}</span>
              </span>
              <span>
                <span className="num text-text">{p.n}</span> {plural(p.n, "item")}
              </span>
              {p.errors > 0 && (
                <span>
                  <span className="num text-err">{p.errors}</span> wrong
                </span>
              )}
            </>
          ) : (
            <span className="text-faint">no measurable leak between these two (under 0.001)</span>
          )}
        </div>
      </div>
      {readOnly && (
        <div className="flex flex-wrap items-center gap-2 border-b border-post/30 bg-post/[0.07] px-4 py-2 text-[11.5px] text-post" data-testid="viewing-banner">
          <span className="mono">Viewing {viewId} (read only)</span>
          <span className="text-faint">·</span>
          <button className="underline decoration-post/50 underline-offset-2 hover:text-text" onClick={() => void restoreVersion(viewId!)} disabled={!!active}>
            Restore to edit
          </button>
          <span className="text-faint">·</span>
          <button className="underline decoration-post/50 underline-offset-2 hover:text-text" onClick={() => viewVersionById(currentId!)} disabled={!!active}>
            Back to {currentId}
          </button>
        </div>
      )}
      {/* Both wordings stay visible while you edit either one. */}
      <div className="grid gap-1 border-b border-line bg-bg/40 px-3 py-2.5" data-testid="pair-summary">
        <SummaryRow id={a} tag="A" active={phone && side === "a"} onClick={phone ? () => setSide("a") : undefined} />
        <SummaryRow id={b} tag="B" active={phone && side === "b"} onClick={phone ? () => setSide("b") : undefined} />
      </div>
      {phone && (
        <div className="flex gap-1 border-b border-line px-3 py-2" role="tablist" aria-label="Option to edit">
          {(["a", "b"] as const).map((k) => (
            <button
              key={k}
              role="tab"
              aria-selected={side === k}
              onClick={() => setSide(k)}
              className={`mono min-h-10 flex-1 truncate rounded-lg border px-2 text-[11px] ${side === k ? "border-signal/50 bg-signal/10 text-text" : "border-line text-muted"}`}
              data-testid={`pair-tab-${k}`}
            >
              {k.toUpperCase()} · {name(k === "a" ? a : b)}
            </button>
          ))}
        </div>
      )}
      <div className="scroll-thin min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {(!phone || side === "a") && <OptionCard id={a} tag="A" />}
        {(!phone || side === "b") && <OptionCard id={b} tag="B" />}
      </div>
      <div className="border-t border-line bg-panel px-3 py-3">
        {otherDirty > 0 && (
          <div className="mono mb-2 text-[10.5px] text-post">
            + {otherDirty} other edited {plural(otherDirty, "option")} will be saved too
          </div>
        )}
        {isDemo && !readOnly && !demoFilled && !pairDirty.length && (
          <button className="btn btn-ghost mb-2 h-8 w-full justify-start text-[11.5px] text-signal" onClick={fillDemo} data-testid="fill-demo">
            Fill in the demo edit (then save)
          </button>
        )}
        <div className="flex items-center gap-2">
          <button
            className="btn btn-primary min-h-10 flex-1"
            disabled={!dirty.length || !!active || readOnly}
            onClick={() => void saveAndRerun()}
            data-testid="save-rerun"
          >
            {active ? "Running…" : "Save & rerun dev"}
            <span className="kbd !hidden !border-black/20 !bg-black/10 !text-[#031312]/70 md:!inline">Ctrl S</span>
          </button>
          <button className="btn min-h-10" disabled={!dirty.length || !!active || readOnly} onClick={() => revertDrafts()} data-testid="revert">
            Revert
          </button>
        </div>
        <div className="mono mt-2 hidden items-center gap-2 text-[10.5px] text-faint md:flex">
          <kbd className="kbd">[</kbd>
          <kbd className="kbd">]</kbd> previous / next pair
          <span className="mx-1">·</span>
          <kbd className="kbd">?</kbd> shortcuts
        </div>
      </div>
    </div>
  );
}

/** One compact line per option: method, name, path and the current `what` (live while you type). */
function SummaryRow({ id, tag, active, onClick }: { id: string; tag: "A" | "B"; active: boolean; onClick?: () => void }) {
  const { t, draft, saved } = useOptionText(id);
  const op = opsById.get(id);
  const dirty = !!draft && !textsEqual(draft, saved);
  const what = t.what?.trim();
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      className={`grid grid-cols-[16px_minmax(0,1fr)] gap-x-2 rounded-md px-1.5 py-1 text-left ${active ? "bg-signal/[0.07]" : ""}`}
      onClick={onClick}
      data-testid={`summary-${tag.toLowerCase()}`}
    >
      <span className="mono pt-px text-[10px] font-semibold text-faint">{tag}</span>
      <span className="min-w-0">
        <span className="flex min-w-0 items-center gap-1.5">
          {op ? <MethodBadge method={op.method} size="sm" /> : <span className="mono text-[9px] text-muted">OPTION</span>}
          <span className="mono truncate text-[11.5px] text-text">{id === NONE ? "none_of_these" : id}</span>
          {dirty && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-post" aria-label="edited" />}
        </span>
        <span className={`line-clamp-2 text-[11px] leading-[1.4] ${what ? "text-muted" : "italic text-faint"}`}>{what || "no `what` text yet"}</span>
      </span>
    </Tag>
  );
}

function OptionCard({ id, tag }: { id: string; tag: "A" | "B" }) {
  const { t, draft, saved, readOnly } = useOptionText(id);
  const op = opsById.get(id);
  const dirty = !!draft && !textsEqual(draft, saved);
  const isNone = id === NONE;
  const update = (patch: Partial<OptionText>) => setDraft(id, patch);
  const examples = t.examples ?? [];
  return (
    <section className="card relative p-3" data-testid="option-card" data-op={id} aria-label={`Option ${tag}: ${id}`}>
      <header className="flex items-start gap-2">
        <span className="mono mt-0.5 text-[10px] font-semibold text-faint">{tag}</span>
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
        <details className="group mt-2.5 rounded-md border border-dashed border-line-2 bg-bg/60 px-2.5 py-1.5" data-testid="spec-text">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-[10.5px] text-muted [&::-webkit-details-marker]:hidden">
            <svg width="8" height="8" viewBox="0 0 8 8" className="shrink-0 transition-transform group-open:rotate-90" aria-hidden>
              <path d="M2 1 L6 4 L2 7" fill="none" stroke="currentColor" strokeWidth="1.3" />
            </svg>
            <span className="eyebrow !text-[9px]">Spec text · read only</span>
            {op.empty && (
              <span className="mono rounded border border-err/40 bg-err/10 px-1.5 py-px text-[9.5px] font-semibold tracking-wider text-err" data-testid="empty-in-spec">
                EMPTY IN SPEC
              </span>
            )}
          </summary>
          {op.empty ? (
            <p className="mt-1 text-[11px] leading-[1.45] text-faint">The spec has no description or summary for this operation, so v0 sends only its method and path.</p>
          ) : (
            <p className="mt-1 text-[11.5px] leading-[1.45] text-muted">{op.description}</p>
          )}
        </details>
      )}
      <Field label="what" hint="What this option is for" value={t.what ?? ""} rows={3} onChange={(v) => update({ what: v })} testId={`what-${id}`} readOnly={readOnly} />
      <Field label="not_for" hint="Look-alike requests that belong elsewhere" value={t.not_for ?? ""} rows={2} onChange={(v) => update({ not_for: v })} testId={`notfor-${id}`} readOnly={readOnly} />
      <Field
        label="examples"
        hint="One example request per line"
        value={examples.join("\n")}
        rows={2}
        onChange={(v) => update({ examples: v.split("\n") })}
        testId={`examples-${id}`}
        readOnly={readOnly}
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

function Field({
  label,
  hint,
  value,
  rows,
  onChange,
  testId,
  readOnly,
}: {
  label: string;
  hint: string;
  value: string;
  rows: number;
  onChange: (v: string) => void;
  testId: string;
  readOnly: boolean;
}) {
  return (
    <label className="mt-2.5 block">
      <span className="flex items-baseline justify-between gap-2">
        <span className="mono text-[10.5px] text-signal/90">{label}</span>
        <span className="truncate text-[10px] text-faint">{hint}</span>
      </span>
      <textarea
        className={`field mt-1 ${readOnly ? "cursor-default opacity-70" : ""}`}
        rows={rows}
        value={value}
        readOnly={readOnly}
        aria-readonly={readOnly}
        onChange={(e) => onChange(e.target.value)}
        data-testid={testId}
        spellCheck={false}
      />
    </label>
  );
}
