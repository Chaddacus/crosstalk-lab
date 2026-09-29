import { motion } from "motion/react";
import type { PairLeak } from "../../core/eval/leakage.ts";
import type { RunRecord } from "../../core/run/runner.ts";
import { NONE } from "../../core/data/catalog.ts";
import { deleteOps, devById } from "../data.ts";
import { StateGlyph } from "../ui/StateGlyph.tsx";

interface Props {
  pair: PairLeak;
  run: RunRecord;
  x: number;
  y: number;
  w: number;
  h: number;
}

export function HoverCard({ pair, run, x, y, w, h }: Props) {
  const worst = pair.worst;
  const item = worst ? devById.get(worst.id) : undefined;
  const res = worst ? run.results.find((r) => r.id === worst.id) : undefined;
  const top3 =
    res?.probs
      ?.map((p, i) => ({ o: run.options[i]!, p }))
      .sort((a, b) => b.p - a.p)
      .slice(0, 3) ?? [];
  const margin = top3.length > 1 ? top3[0]!.p - top3[1]!.p : NaN;
  const wrongDelete = !!(res?.chosen && item && res.chosen !== item.gold && deleteOps.has(res.chosen));
  const cardW = 320;
  const left = Math.min(Math.max(8, x + 18), w - cardW - 8);
  const top = Math.min(Math.max(8, y + 14), h - 290);
  const [a, b] = pair.a === NONE ? [pair.b, pair.a] : [pair.a, pair.b];
  const ab = pair.a === a ? pair.ab : pair.ba;
  const ba = pair.a === a ? pair.ba : pair.ab;
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.12 }}
      className="pointer-events-none absolute z-20 rounded-xl border border-line-2 bg-panel/95 p-3.5 shadow-[0_18px_50px_-12px_rgb(0_0_0/0.8)] backdrop-blur-md"
      style={{ left, top, width: cardW }}
      data-testid="hover-card"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="mono min-w-0 text-[12px] leading-5 text-text">
          <div className="truncate">{a}</div>
          <div className="truncate text-muted">⇄ {b === NONE ? "NO MATCH" : b}</div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <StateGlyph state={pair.state} withLabel />
          {wrongDelete && (
            <span className="pulse mono rounded border border-delete/60 bg-delete/15 px-1.5 py-0.5 text-[9.5px] font-semibold tracking-wider text-delete" data-testid="delete-badge">
              DELETE PICKED
            </span>
          )}
        </div>
      </div>
      <div className="mt-2.5 grid grid-cols-3 gap-2 border-y border-line py-2">
        <Stat label="leak" value={pair.mass.toFixed(2)} />
        <Stat label="a → b" value={ab.toFixed(2)} />
        <Stat label="b → a" value={ba.toFixed(2)} />
      </div>
      {item && res && (
        <div className="mt-2.5">
          <div className="flex items-center justify-between">
            <span className="eyebrow !text-[9.5px]">worst item · {item.id}</span>
            <span className="mono text-[10px] text-faint">{pair.n} leaking items</span>
          </div>
          <p className="mt-1 text-[12.5px] leading-[1.45] text-text">“{item.query}”</p>
          <div className="mono mt-1.5 text-[10.5px] text-muted">
            gold <span className="text-fixed">{item.gold === NONE ? "NO MATCH" : item.gold}</span>
          </div>
          <div className="mt-2 space-y-1">
            {top3.map((t) => (
              <div key={t.o} className="grid grid-cols-[1fr_88px_36px] items-center gap-2">
                <span className={`mono truncate text-[10.5px] ${t.o === item.gold ? "text-fixed" : t.o === res.chosen ? "text-err" : "text-muted"}`}>
                  {t.o === NONE ? "NO MATCH" : t.o}
                </span>
                <span className="h-1.5 overflow-hidden rounded-full bg-line">
                  <span
                    className="block h-full rounded-full"
                    style={{ width: `${Math.max(2, t.p * 100)}%`, background: t.o === item.gold ? "var(--fixed)" : t.o === res.chosen ? "var(--err)" : "var(--bgchord)" }}
                  />
                </span>
                <span className="num text-right text-[10.5px] text-text">{t.p.toFixed(2)}</span>
              </div>
            ))}
          </div>
          <div className="mono mt-1.5 text-[10.5px] text-faint">margin {Number.isFinite(margin) ? margin.toFixed(2) : "—"} · click to edit wording</div>
        </div>
      )}
    </motion.div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="eyebrow !text-[9px]">{label}</div>
      <div className="num text-[13px] text-text">{value}</div>
    </div>
  );
}
