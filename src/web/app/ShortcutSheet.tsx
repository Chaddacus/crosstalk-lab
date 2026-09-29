import { AnimatePresence, motion } from "motion/react";
import { useRef } from "react";
import { useStore } from "../store.ts";
import { useDialog } from "../ui/dialog.ts";

const ROWS: [string[], string][] = [
  [["Ctrl", "S"], "Save the edited wording and rerun the dev set"],
  [["["], "Previous chord"],
  [["]"], "Next chord"],
  [["←", "→"], "Move around the ring (map focused)"],
  [["Enter"], "Focus that operation (map focused)"],
  [["Esc"], "Close the editor, inspector, sheet or dialog"],
  [["1", "2", "3"], "Map · Gate · Items"],
  [["?"], "This sheet"],
];

export function ShortcutSheet() {
  const open = useStore((s) => s.shortcuts);
  return <AnimatePresence>{open && <Sheet key="sheet" />}</AnimatePresence>;
}

function Sheet() {
  const ref = useRef<HTMLDivElement>(null);
  const close = () => useStore.setState({ shortcuts: false });
  useDialog(true, ref, close);
  return (
    <motion.div className="fixed inset-0 z-50 flex items-center justify-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={close} />
      <motion.div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        tabIndex={-1}
        className="relative w-full max-w-[440px] rounded-2xl border border-line-2 bg-panel p-5 outline-none"
        initial={{ y: 10, scale: 0.98 }}
        animate={{ y: 0, scale: 1 }}
        exit={{ y: 10, scale: 0.98 }}
        data-testid="shortcut-sheet"
      >
        <div className="flex items-center justify-between">
          <h2 id="shortcuts-title" className="eyebrow">
            Keyboard
          </h2>
          <button className="btn btn-ghost h-8 px-2" onClick={close} aria-label="Close keyboard shortcuts" data-autofocus data-testid="shortcuts-close">
            <kbd className="kbd">Esc</kbd>
          </button>
        </div>
        <ul className="mt-3 divide-y divide-line">
          {ROWS.map(([keys, label]) => (
            <li key={label} className="flex items-center justify-between gap-4 py-2 text-[12.5px] text-muted">
              <span>{label}</span>
              <span className="flex gap-1">
                {keys.map((k) => (
                  <kbd key={k} className="kbd">
                    {k}
                  </kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[11px] text-faint">On macOS, Ctrl S also works as ⌘ S.</p>
      </motion.div>
    </motion.div>
  );
}
