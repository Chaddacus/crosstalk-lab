import { AnimatePresence, motion } from "motion/react";
import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { NONE } from "../../core/data/catalog.ts";
import { criterionFields } from "../../core/jev/mock-lexsim.ts";
import { tokenize } from "../../core/jev/text.ts";
import { catalog, opsById } from "../data.ts";
import { useAnalysis } from "../analysis.ts";
import { useStore, viewVersion } from "../store.ts";
import { MethodBadge } from "../ui/MethodBadge.tsx";
import { useDialog } from "../ui/dialog.ts";
import { useLayoutMode } from "../lib/hooks.ts";
import { codeLabel } from "../lib/errors.ts";

type StateFilter = "all" | "correct" | "wrong" | "fixed" | "broke" | "error";

export function ItemsView() {
  const { scored, diff, run, before } = useAnalysis();
  const narrow = useLayoutMode() === "narrow";
  const itemId = useStore((s) => s.itemId);
  const [family, setFamily] = useState("all");
  const [state, setState] = useState<StateFilter>("all");
  const [method, setMethod] = useState("all");
  const [q, setQ] = useState("");
  const statusById = useMemo(() => new Map(diff?.items.map((d) => [d.id, d.status]) ?? []), [diff]);
  const rows = useMemo(
    () =>
      scored.filter((s) => {
        if (family !== "all" && s.family !== family) return false;
        if (method !== "all" && opsById.get(s.gold)?.method !== method) return false;
        if (state === "correct" && !s.correct) return false;
        if (state === "wrong" && (s.correct || s.error)) return false;
        if (state === "error" && !s.error) return false;
        if ((state === "fixed" || state === "broke") && statusById.get(s.id) !== state) return false;
        if (q && !s.query.toLowerCase().includes(q.toLowerCase()) && !s.gold.toLowerCase().includes(q.toLowerCase())) return false;
        return true;
      }),
    [scored, family, method, state, q, statusById],
  );
  return (
    <div className="flex h-full min-h-0" data-testid="items-view">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <span className="eyebrow mr-2">Dev items</span>
          <input className="field !w-56 !py-1.5" placeholder="Search query or gold…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search items" />
          <Select label="Family" value={family} onChange={setFamily} options={["all", ...catalog.families.map((f) => f.name), "none"]} />
          <Select label="State" value={state} onChange={(v) => setState(v as StateFilter)} options={["all", "correct", "wrong", "fixed", "broke", "error"]} />
          <Select label="Method" value={method} onChange={setMethod} options={["all", "GET", "POST", "DELETE"]} />
          <span className="mono ml-auto text-[11px] text-faint">
            {rows.length} of {scored.length}
          </span>
        </div>
        <div className="scroll-thin min-h-0 flex-1 overflow-auto" tabIndex={0} role="region" aria-label="Dev items table" data-testid="items-scroll">
          <table className="w-full min-w-[820px] border-separate border-spacing-0 text-[12px]">
            <thead className="sticky top-0 z-10 bg-panel">
              <tr className="text-left">
                {["id", "query", "gold", "prediction", "p(gold)", "margin", "conf.", "flip"].map((h) => (
                  <th key={h} className="eyebrow whitespace-nowrap border-b border-line px-3 py-2 !text-[9.5px] font-normal">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const st = statusById.get(s.id);
                return (
                  <tr
                    key={s.id}
                    className={`cursor-pointer transition-colors ${itemId === s.id ? "bg-signal/[0.07]" : "hover:bg-panel-2"}`}
                    onClick={() => useStore.setState({ itemId: s.id })}
                    data-testid="item-row"
                  >
                    <td className="mono whitespace-nowrap border-b border-line px-1.5 py-1 text-faint">
                      <button
                        className="min-h-8 rounded px-1.5 text-left hover:text-text"
                        onClick={(e) => {
                          e.stopPropagation();
                          useStore.setState({ itemId: s.id });
                        }}
                        aria-label={`Inspect item ${s.id}`}
                        data-testid="item-open"
                      >
                        {s.id}
                      </button>
                    </td>
                    <td className="max-w-[300px] truncate border-b border-line px-3 py-2 text-text" title={s.query}>{s.query}</td>
                    <td className="mono max-w-[170px] truncate border-b border-line px-3 py-2 text-muted">{s.gold === NONE ? "NO MATCH" : s.gold}</td>
                    <td className={`mono max-w-[170px] truncate border-b border-line px-3 py-2 ${s.error ? "text-err" : s.correct ? "text-fixed" : "text-err"}`}>
                      {s.error ? "error" : s.chosen === NONE ? "NO MATCH" : s.chosen}
                    </td>
                    <td className="border-b border-line px-3 py-2">
                      <span className="flex items-center gap-2">
                        <span className="h-1.5 w-14 overflow-hidden rounded-full bg-line">
                          <span className="block h-full rounded-full" style={{ width: `${(s.pGold || 0) * 100}%`, background: s.correct ? "var(--fixed)" : "var(--err)" }} />
                        </span>
                        <span className="num text-text">{Number.isFinite(s.pGold) ? s.pGold.toFixed(2) : "—"}</span>
                      </span>
                    </td>
                    <td className="num border-b border-line px-3 py-2 text-muted">{Number.isFinite(s.margin) ? s.margin.toFixed(2) : "—"}</td>
                    <td className="num border-b border-line px-3 py-2 text-muted">{Number.isFinite(s.confidence) ? s.confidence.toFixed(2) : "—"}</td>
                    <td className="border-b border-line px-3 py-2">
                      {st === "fixed" || st === "broke" ? (
                        <span className={`mono rounded px-1 text-[9px] font-semibold tracking-wider ${st === "fixed" ? "bg-fixed/15 text-fixed" : "bg-broke/15 text-broke"}`}>{st.toUpperCase()}</span>
                      ) : (
                        <span className="text-faint">·</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {narrow ? (
        <AnimatePresence>{itemId && run && <InspectorSheet key={itemId} id={itemId} before={before} />}</AnimatePresence>
      ) : (
        <AnimatePresence>{itemId && run && <Inspector key={itemId} id={itemId} before={before} />}</AnimatePresence>
      )}
    </div>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <label className="flex items-center gap-1.5 text-[11px] text-muted">
      {label}
      <select className="rounded-md border border-line bg-bg px-2 py-1 text-[12px] text-text" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Phone: the inspector as a full-screen dialog above the (inert) app, with its own visible Close button. */
function InspectorSheet({ id, before }: { id: string; before: ReturnType<typeof useAnalysis>["before"] }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialog(true, ref, () => useStore.setState({ itemId: null }));
  return createPortal(
    <motion.div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label={`Item ${id}`}
      tabIndex={-1}
      className="scroll-thin fixed inset-0 z-50 overflow-y-auto bg-panel outline-none"
      initial={{ y: 24, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 24, opacity: 0 }}
      transition={{ type: "spring", stiffness: 340, damping: 32 }}
      data-testid="inspector"
    >
      <InspectorBody id={id} before={before} sheet />
    </motion.div>,
    document.body,
  );
}

function Inspector({ id, before }: { id: string; before: ReturnType<typeof useAnalysis>["before"] }) {
  return (
    <motion.aside
      initial={{ x: 40, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 40, opacity: 0 }}
      transition={{ type: "spring", stiffness: 340, damping: 32 }}
      className="scroll-thin absolute inset-y-0 right-0 z-20 w-full max-w-[400px] overflow-y-auto border-l border-line-2 bg-panel shadow-[-30px_0_80px_-20px_rgb(0_0_0/0.8)] md:relative md:shrink-0"
      aria-label={`Item ${id}`}
      data-testid="inspector"
    >
      <InspectorBody id={id} before={before} />
    </motion.aside>
  );
}

function InspectorBody({ id, before, sheet = false }: { id: string; before: ReturnType<typeof useAnalysis>["before"]; sheet?: boolean }) {
  const { run, scored } = useAnalysis();
  const backend = useStore((s) => s.backend);
  const v = useStore((s) => viewVersion(s));
  const s = scored.find((x) => x.id === id);
  const r = run?.results.find((x) => x.id === id);
  const prev = before?.results.find((x) => x.id === id);
  if (!s || !r || !run) return null;
  const close = () => useStore.setState({ itemId: null });
  const header = (
    <div className={`flex items-center justify-between border-b border-line px-4 py-3 ${sheet ? "sticky top-0 z-10 bg-panel" : ""}`}>
      <span className="eyebrow">Item · {s.id}</span>
      <button className="btn btn-ghost h-9 px-2.5" onClick={close} aria-label="Close inspector" data-autofocus data-testid="inspector-close">
        {sheet ? <span className="text-[12px]">Close</span> : <kbd className="kbd">Esc</kbd>}
      </button>
    </div>
  );
  if (r.error) {
    return (
      <>
        {header}
        <div className="p-4" data-testid="inspector-error">
          <p className="text-[14px] leading-[1.5] text-text">“{s.query}”</p>
          <div className="mono mt-2 text-[11px] text-muted">
            gold <span className="text-fixed">{s.gold === NONE ? "NO MATCH" : s.gold}</span>
          </div>
          <div className="mt-4 rounded-xl border border-err/40 bg-err/[0.07] p-3">
            <div className="mono text-[10px] font-semibold tracking-wider text-err">NOT SCORED · {codeLabel(r.error.code).toUpperCase()}</div>
            <p className="mt-1.5 text-[12px] leading-[1.5] text-muted">This item failed, so it is not counted as right, wrong or unchanged. The backend said:</p>
            <p className="mono mt-1.5 break-words text-[11px] text-text">
              {r.error.code}: {r.error.message}
            </p>
          </div>
        </div>
      </>
    );
  }
  const top = (r.probs ?? [])
    .map((p, i) => ({ o: run.options[i]!, p, prev: prev?.probs?.[i] ?? NaN }))
    .sort((a, b) => b.p - a.p)
    .slice(0, 10);
  if (!top.some((t) => t.o === s.gold) && r.probs) {
    const gi = run.options.indexOf(s.gold);
    top.push({ o: s.gold, p: r.probs[gi]!, prev: prev?.probs?.[gi] ?? NaN });
  }
  const qTokens = new Set(tokenize(s.query));
  return (
    <>
      {header}
      <div className="p-4">
        <p className="text-[14px] leading-[1.5] text-text">“{s.query}”</p>
        <div className="mono mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
          <span>
            gold <span className="text-fixed">{s.gold === NONE ? "NO MATCH" : s.gold}</span>
          </span>
          <span>
            pick <span className={s.correct ? "text-fixed" : "text-err"}>{s.chosen === NONE ? "NO MATCH" : s.chosen}</span>
          </span>
          <span>
            margin <span className="num text-text">{s.margin.toFixed(2)}</span>
          </span>
        </div>
        <div className="mt-4 flex items-center justify-between">
          <span className="eyebrow !text-[9.5px]">Top 10 of {run.options.length}</span>
          {prev && <span className="mono text-[10px] text-faint">ghost bars: previous run</span>}
        </div>
        <ul className="mt-2 space-y-1.5">
          {top.map((t) => (
            <li key={t.o} className="grid grid-cols-[1fr_120px_38px] items-center gap-2">
              <span className={`mono truncate text-[11px] ${t.o === s.gold ? "text-fixed" : t.o === s.chosen ? "text-err" : "text-muted"}`}>{t.o === NONE ? "NO MATCH" : t.o}</span>
              <span className="relative h-2 rounded-full bg-line">
                {Number.isFinite(t.prev) && <span className="absolute inset-y-0 left-0 rounded-full border border-faint/60" style={{ width: `${t.prev * 100}%` }} />}
                <span
                  className="absolute inset-y-0 left-0 rounded-full"
                  style={{ width: `${Math.max(1, t.p * 100)}%`, background: t.o === s.gold ? "var(--fixed)" : t.o === s.chosen ? "var(--err)" : "var(--bgchord)", opacity: 0.9 }}
                />
              </span>
              <span className="num text-right text-[11px] text-text">{t.p.toFixed(3)}</span>
            </li>
          ))}
        </ul>
        {backend !== "live" && v && (
          <div className="mt-5 rounded-xl border border-post/30 bg-post/[0.05] p-3" data-testid="why">
            <div className="mono text-[10px] font-semibold tracking-wider text-post">WHY (LEXICAL STAND-IN)</div>
            <p className="mt-1 text-[11px] leading-[1.5] text-muted">The mock scores word overlap. Highlighted words matched the request after stemming. A live backend returns no explanation, so none is shown there.</p>
            {[s.gold, s.chosen]
              .filter((o, i, a): o is string => !!o && a.indexOf(o) === i)
              .map((o) => {
                const f = criterionFields(v.criteria[o] ?? null);
                const text = [o, f.what, f.examples].filter(Boolean).join(" · ");
                return (
                  <div key={o} className="mt-2.5">
                    <div className="flex items-center gap-1.5">
                      {opsById.get(o) && <MethodBadge method={opsById.get(o)!.method} size="sm" />}
                      <span className={`mono text-[11px] ${o === s.gold ? "text-fixed" : "text-err"}`}>{o}</span>
                    </div>
                    <p className="mt-1 text-[11.5px] leading-[1.55] text-muted">
                      <Highlight text={text} tokens={qTokens} />
                    </p>
                    {f.notFor && (
                      <p className="mt-0.5 text-[11px] text-faint">
                        not_for: <Highlight text={f.notFor} tokens={qTokens} />
                      </p>
                    )}
                  </div>
                );
              })}
          </div>
        )}
      </div>
    </>
  );
}

function Highlight({ text, tokens }: { text: string; tokens: Set<string> }) {
  const parts = text.split(/(\s+|[^A-Za-z0-9\s]+)/);
  return (
    <>
      {parts.map((p, i) => {
        const t = tokenize(p);
        const hit = t.length > 0 && t.some((x) => tokens.has(x));
        return hit ? (
          <mark key={i} className="rounded bg-signal/20 px-0.5 text-text">
            {p}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        );
      })}
    </>
  );
}
