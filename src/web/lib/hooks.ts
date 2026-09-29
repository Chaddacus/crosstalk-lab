import { useEffect, useLayoutEffect, useRef, useState } from "react";

export function useClickOutside(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("pointerdown", h);
    return () => window.removeEventListener("pointerdown", h);
  }, [open, onClose]);
  return ref;
}

/** Layout mode from the viewport width: wide ≥ 1280, medium 768–1279, narrow < 768. */
export function useLayoutMode(): "wide" | "medium" | "narrow" {
  const get = (): "wide" | "medium" | "narrow" =>
    typeof window === "undefined" ? "wide" : window.innerWidth >= 1280 ? "wide" : window.innerWidth >= 768 ? "medium" : "narrow";
  const [mode, setMode] = useState(get);
  useLayoutEffect(() => {
    const on = () => setMode(get());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return mode;
}
