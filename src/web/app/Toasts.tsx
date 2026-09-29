import { AnimatePresence, motion } from "motion/react";
import { useStore } from "../store.ts";

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed bottom-24 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2" aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6 }}
            className={`pointer-events-auto max-w-[92vw] rounded-lg border px-3.5 py-2 text-[12.5px] shadow-lg backdrop-blur ${
              t.kind === "error" ? "border-err/50 bg-err/15 text-text" : t.kind === "success" ? "border-fixed/40 bg-fixed/10 text-text" : "border-line-2 bg-panel-2/95 text-text"
            }`}
            role={t.kind === "error" ? "alert" : "status"}
          >
            {t.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
