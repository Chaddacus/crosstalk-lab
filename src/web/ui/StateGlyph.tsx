import type { PairState } from "../../core/eval/leakage.ts";

/** Chord state shown with line style as well as color (never color alone). */
export function StateGlyph({ state, withLabel = false }: { state: PairState; withLabel?: boolean }) {
  const color = state === "error" ? "var(--err)" : state === "near" ? "var(--near)" : "var(--bgchord)";
  const label = state === "error" ? "ERROR" : state === "near" ? "NEAR-MISS" : "BACKGROUND";
  return (
    <span className="inline-flex items-center gap-1.5" title={label.toLowerCase()}>
      <svg width="16" height="8" aria-hidden className="shrink-0">
        {state === "error" && <line x1="1" y1="4" x2="15" y2="4" stroke={color} strokeWidth="5" opacity="0.3" />}
        <line
          x1="1"
          y1="4"
          x2="15"
          y2="4"
          stroke={color}
          strokeWidth={state === "background" ? 1.3 : 2}
          strokeDasharray={state === "near" ? "3 2.5" : undefined}
          strokeLinecap="round"
        />
      </svg>
      {withLabel && (
        <span className="mono text-[9.5px] font-semibold tracking-wider" style={{ color }}>
          {label}
        </span>
      )}
      {!withLabel && <span className="sr-only">{label}</span>}
    </span>
  );
}
