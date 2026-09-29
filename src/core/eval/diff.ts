/** "Since last run": per-item fixed / broke / unchanged between two runs of the same split. */
import type { Scored } from "./metrics.ts";

export type DiffStatus = "fixed" | "broke" | "unchanged" | "error";

export interface ItemDiff {
  id: string;
  query: string;
  gold: string;
  before: { chosen: string | null; pGold: number; correct: boolean };
  after: { chosen: string | null; pGold: number; correct: boolean };
  status: DiffStatus;
  dpGold: number;
}

export interface RunDiff {
  items: ItemDiff[];
  fixed: number;
  broke: number;
  unchanged: number;
  errors: number;
  /** Fixed and broke items, broke first, then by |Δp(gold)|. */
  flipped: ItemDiff[];
}

export function diffRuns(before: Scored[], after: Scored[]): RunDiff {
  const prev = new Map(before.map((s) => [s.id, s]));
  const items: ItemDiff[] = [];
  for (const a of after) {
    const b = prev.get(a.id);
    if (!b) continue;
    const status: DiffStatus =
      a.error || b.error ? "error" : !b.correct && a.correct ? "fixed" : b.correct && !a.correct ? "broke" : "unchanged";
    items.push({
      id: a.id,
      query: a.query,
      gold: a.gold,
      before: { chosen: b.chosen, pGold: b.pGold, correct: b.correct },
      after: { chosen: a.chosen, pGold: a.pGold, correct: a.correct },
      status,
      dpGold: a.error || b.error ? NaN : a.pGold - b.pGold,
    });
  }
  const count = (s: DiffStatus) => items.filter((i) => i.status === s).length;
  const flipped = items
    .filter((i) => i.status === "fixed" || i.status === "broke")
    .sort((x, y) => (x.status === y.status ? Math.abs(y.dpGold) - Math.abs(x.dpGold) : x.status === "broke" ? -1 : 1));
  return { items, fixed: count("fixed"), broke: count("broke"), unchanged: count("unchanged"), errors: count("error"), flipped };
}
