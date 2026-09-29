import { useStore } from "../store.ts";

/** Permanent backend watermark on the map. In MOCK it never goes away. */
export function BackendChip({ compact = false }: { compact?: boolean }) {
  const backend = useStore((s) => s.backend);
  const health = useStore((s) => s.health);
  if (backend === "live")
    return (
      <span className="mono inline-flex items-center gap-2 rounded-md border border-signal/50 bg-signal/10 px-2.5 py-1 text-[11px] text-signal" data-testid="backend-chip">
        <span className="h-1.5 w-1.5 rounded-full bg-signal" />
        {health?.model ?? "jev"} · live
      </span>
    );
  if (backend === "replay")
    return (
      <span className="mono inline-flex items-center gap-2 rounded-md border border-line-2 bg-panel-2 px-2.5 py-1 text-[11px] text-muted" data-testid="backend-chip">
        <span className="h-1.5 w-1.5 rounded-full bg-muted" />
        REPLAY · cached mock responses
      </span>
    );
  return (
    <span
      className={`mono inline-flex items-center gap-2 rounded-md border border-post/45 bg-post/10 font-medium text-post ${compact ? "px-2 py-0.5 text-[9.5px]" : "px-2.5 py-1 text-[11px]"}`}
      data-testid="mock-watermark"
      title="The MOCK backend is a deterministic BM25 scorer over the option text. It is not Jev and says nothing about any model."
    >
      <svg width="14" height="8" viewBox="0 0 14 8" aria-hidden>
        <path d="M1 4 C 3 -1, 5 9, 7 4 S 11 -1, 13 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      MOCK · lexical stand-in, not Jev
    </span>
  );
}
