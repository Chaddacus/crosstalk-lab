import type { HttpMethod } from "../../core/data/catalog.ts";

export function methodColor(m: HttpMethod | string): string {
  return m === "GET" ? "var(--get)" : m === "POST" ? "var(--post)" : m === "DELETE" ? "var(--delete)" : "var(--muted)";
}

export function MethodBadge({ method, size = "md" }: { method: HttpMethod | string; size?: "sm" | "md" }) {
  const c = methodColor(method);
  return (
    <span
      className={`mono inline-flex items-center justify-center rounded-[5px] border font-semibold tracking-wide ${
        size === "sm" ? "h-[16px] px-1 text-[9px]" : "h-[19px] px-1.5 text-[10px]"
      }`}
      style={{ color: c, borderColor: `color-mix(in srgb, ${c} 45%, transparent)`, background: `color-mix(in srgb, ${c} 12%, transparent)` }}
    >
      {method === "DELETE" && (
        <svg width="7" height="7" viewBox="0 0 8 8" className="mr-1" aria-hidden>
          <path d="M1 1 L7 7 M7 1 L1 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      )}
      {method}
    </span>
  );
}
