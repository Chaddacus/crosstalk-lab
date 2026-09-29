import { NONE } from "../../core/data/catalog.ts";
import { useVisiblePairs } from "../map/MapView.tsx";
import { selectPair, useStore } from "../store.ts";
import { StateGlyph } from "../ui/StateGlyph.tsx";
import { useAnalysis } from "../analysis.ts";
import { pct } from "../lib/format.ts";

/** Accessible alternative to the map: the ranked top chords. */
export function PairsList() {
  const { visible } = useVisiblePairs();
  const { acc } = useAnalysis();
  const hoverPair = useStore((s) => s.hoverPair);
  const top = visible.slice(0, 10);
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="pairs-list">
      <div className="px-4 pb-2 pt-3.5">
        <div className="eyebrow">Top confusions</div>
        <p className="mt-2 text-[12.5px] leading-[1.5] text-muted">
          Each chord is probability leaking between two look-alike operations on the dev set. Point at one to see its worst item. Select it to rewrite the wording of
          both, then save to rerun.
        </p>
      </div>
      <ol className="scroll-thin min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-3">
        {top.map((p, i) => {
          const a = p.a === NONE ? p.b : p.a;
          const b = p.a === NONE ? p.a : p.b;
          return (
            <li key={p.key}>
              <button
                className={`group grid w-full grid-cols-[18px_20px_1fr_auto] items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors ${
                  hoverPair === p.key ? "border-line-2 bg-panel-2" : "border-transparent hover:border-line hover:bg-panel-2/70"
                }`}
                onMouseEnter={() => useStore.setState({ hoverPair: p.key })}
                onMouseLeave={() => useStore.setState({ hoverPair: null })}
                onFocus={() => useStore.setState({ hoverPair: p.key })}
                onBlur={() => useStore.setState({ hoverPair: null })}
                onClick={() => selectPair(a, b)}
                data-testid="pairs-item"
                data-pair={p.key}
              >
                <span className="num text-[10.5px] text-faint">{i + 1}</span>
                <StateGlyph state={p.state} />
                <span className="mono min-w-0 text-[11.5px] leading-[1.35] text-text">
                  <span className="block truncate">{a}</span>
                  <span className="block truncate text-muted">⇄ {b === NONE ? "NO MATCH" : b}</span>
                </span>
                <span className="num text-[12px] text-text">{p.mass.toFixed(2)}</span>
              </button>
            </li>
          );
        })}
        {!top.length && <li className="px-3 py-6 text-center text-[12px] text-faint">Waiting for the first run…</li>}
      </ol>
      <div className="border-t border-line px-4 py-3 text-[11px] leading-[1.5] text-faint">
        Leak is measured in items' worth of probability. Dev accuracy now <span className="num text-muted">{acc ? pct(acc.all.p) : "—"}</span>.
      </div>
    </div>
  );
}
