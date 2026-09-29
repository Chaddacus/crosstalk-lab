import { NONE } from "../../core/data/catalog.ts";
import { LensSwitch, useVisiblePairs } from "../map/MapView.tsx";
import { selectPair, useStore } from "../store.ts";
import { StateGlyph } from "../ui/StateGlyph.tsx";
import { MethodBadge } from "../ui/MethodBadge.tsx";
import { useAnalysis } from "../analysis.ts";
import { pct } from "../lib/format.ts";
import { deleteOps, opsById } from "../data.ts";
import { DEMO, DEMO_KEY } from "../demo.ts";

const COPY = {
  ops: {
    title: "Top look-alike confusions",
    body: "Probability that leaks between two operations on the dev set. Red means at least one request was routed to the wrong one of the two. Point at a pair to see its worst request; select it to rewrite both wordings, then save to rerun.",
  },
  hub: {
    title: "Top NO MATCH leaks",
    body: "Probability that leaks between an operation and NO MATCH (none_of_these): off-topic requests the router sends to an operation, or real requests it gives up on.",
  },
  all: {
    title: "Top confusions",
    body: "Look-alike pairs and NO MATCH leaks, ranked together by leaked mass. Point at one to see its worst request; select it to rewrite the wording.",
  },
} as const;

/** Accessible alternative to the map: the ranked top chords of the current lens. */
export function PairsList() {
  const { visible } = useVisiblePairs();
  const { acc, leak, run } = useAnalysis();
  const hoverPair = useStore((s) => s.hoverPair);
  const lens = useStore((s) => s.lens);
  const deleteOnly = useStore((s) => s.deleteOnly);
  const top = visible.slice(0, 10);
  const max = top[0]?.mass ?? 1;
  const demoPair = leak?.pairs.find((p) => p.key === DEMO_KEY);
  const copy = COPY[lens];
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="pairs-list">
      <div className="px-4 pb-2 pt-3.5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="eyebrow">{copy.title}</h2>
        </div>
        <div className="mt-2.5">
          <LensSwitch size="sm" />
        </div>
        <p className="mt-2.5 text-[12.5px] leading-[1.5] text-muted">
          {copy.body}
          {deleteOnly && <span className="text-delete"> Showing only pairs that touch a DELETE operation.</span>}
        </p>
      </div>
      <ol className="scroll-thin min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-3" aria-label={copy.title}>
        {top.map((p, i) => {
          const a = p.a === NONE ? p.b : p.a;
          const b = p.a === NONE ? p.a : p.b;
          const touchesDelete = deleteOps.has(a) || deleteOps.has(b);
          return (
            <li key={p.key}>
              <button
                className={`group grid min-h-12 w-full grid-cols-[18px_20px_1fr_auto] items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors ${
                  hoverPair === p.key ? "border-line-2 bg-panel-2" : "border-transparent hover:border-line hover:bg-panel-2/70"
                }`}
                onMouseEnter={() => useStore.setState({ hoverPair: p.key })}
                onMouseLeave={() => useStore.setState({ hoverPair: null })}
                onFocus={() => useStore.setState({ hoverPair: p.key })}
                onBlur={() => useStore.setState({ hoverPair: null })}
                onClick={() => selectPair(a, b)}
                data-testid="pairs-item"
                data-pair={p.key}
                aria-label={`${i + 1}. ${a} and ${b === NONE ? "NO MATCH" : b}, ${p.state === "background" ? "background leak" : p.state}, leaked mass ${p.mass.toFixed(2)}`}
              >
                <span className="num text-[10.5px] text-faint">{i + 1}</span>
                <StateGlyph state={p.state} />
                <span className="mono min-w-0 text-[11.5px] leading-[1.35] text-text">
                  <span className="block truncate">{a}</span>
                  <span className="block truncate text-muted">
                    ⇄ {b === NONE ? "NO MATCH" : b}
                    {touchesDelete && <span className="ml-1.5 text-[9.5px] text-delete">DELETE</span>}
                  </span>
                </span>
                <span className="flex flex-col items-end gap-1">
                  <span className="num text-[12px] text-text">{p.mass.toFixed(2)}</span>
                  <span className="block h-[3px] w-12 overflow-hidden rounded-full bg-line" aria-hidden>
                    <span
                      className="block h-full rounded-full"
                      style={{
                        width: `${Math.max(4, (p.mass / max) * 100)}%`,
                        background: p.state === "error" ? "var(--err)" : p.state === "near" ? "var(--near)" : "var(--bgchord)",
                        opacity: 0.75,
                      }}
                    />
                  </span>
                </span>
              </button>
            </li>
          );
        })}
        {!top.length && (
          <li className="px-3 py-6 text-center text-[12px] text-faint">{leak && run?.results.length ? "No pairs match this filter." : "Waiting for the first results…"}</li>
        )}
      </ol>
      <div className="space-y-2 border-t border-line px-3 py-3">
        <button
          className="group flex min-h-11 w-full items-center gap-2 rounded-lg border border-signal/30 bg-signal/[0.06] px-2.5 py-2 text-left transition-colors hover:border-signal/60"
          onClick={() => selectPair(DEMO.pair[0], DEMO.pair[1])}
          onMouseEnter={() => demoPair && useStore.setState({ hoverPair: DEMO_KEY })}
          onMouseLeave={() => useStore.setState({ hoverPair: null })}
          data-testid="demo-pair"
        >
          <span className="mono shrink-0 rounded bg-signal/15 px-1.5 py-0.5 text-[9.5px] font-semibold tracking-wider text-signal">TRY</span>
          <span className="min-w-0 flex-1">
            <span className="block text-[11.5px] text-text">The demo pair: a stop that became a delete</span>
            {DEMO.pair.map((o, i) => (
              <span key={o} className="mono mt-0.5 flex min-w-0 items-center gap-1 text-[10.5px] text-muted">
                <span className="w-2.5 shrink-0 text-signal">{i > 0 ? "⇄" : ""}</span>
                {opsById.get(o) && <MethodBadge method={opsById.get(o)!.method} size="sm" />}
                <span className="truncate">{o}</span>
              </span>
            ))}
          </span>
        </button>
        <p className="px-1 text-[11px] leading-[1.5] text-faint">
          Leaked mass is measured in items' worth of probability. Dev accuracy now <span className="num text-muted">{acc ? pct(acc.all.p) : "—"}</span>.
        </p>
      </div>
    </div>
  );
}
