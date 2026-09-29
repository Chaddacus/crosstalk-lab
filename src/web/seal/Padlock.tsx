import { motion, useReducedMotion } from "motion/react";

/** Padlock whose shackle lifts and swings open when the test set is unsealed. */
export function Padlock({ open, size = 16, color }: { open: boolean; size?: number; color?: string }) {
  const reduce = useReducedMotion();
  const c = color ?? (open ? "var(--post)" : "var(--muted)");
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className="shrink-0 overflow-visible">
      <motion.path
        d="M7.5 11 V8 a4.5 4.5 0 0 1 9 0 V11"
        fill="none"
        stroke={c}
        strokeWidth="2.2"
        strokeLinecap="round"
        style={{ originX: "16.5px", originY: "11px" }}
        initial={false}
        animate={open ? { y: -3.5, rotate: reduce ? 0 : 28 } : { y: 0, rotate: 0 }}
        transition={reduce ? { duration: 0.15 } : { type: "spring", stiffness: 260, damping: 14 }}
      />
      <rect x="5" y="11" width="14" height="10" rx="2.5" fill={c} opacity={open ? 0.9 : 0.85} />
      <circle cx="12" cy="16" r="1.5" fill="var(--bg)" />
    </svg>
  );
}
