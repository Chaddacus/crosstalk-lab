import { animate, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

/** Number that ticks to its new value. Tabular figures so digits do not jump. */
export function Ticker({ value, format = (v) => String(Math.round(v)), className = "", testId }: { value: number; format?: (v: number) => string; className?: string; testId?: string }) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (!Number.isFinite(value)) {
      setShown(value);
      return;
    }
    if (reduce || !Number.isFinite(from.current)) {
      from.current = value;
      setShown(value);
      return;
    }
    const c = animate(from.current, value, {
      duration: 0.5,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => setShown(v),
    });
    from.current = value;
    return () => c.stop();
  }, [value, reduce]);
  return (
    <span className={`num ${className}`} data-testid={testId} data-value={Number.isFinite(value) ? value : ""}>
      {Number.isFinite(shown) ? format(shown) : "—"}
    </span>
  );
}
