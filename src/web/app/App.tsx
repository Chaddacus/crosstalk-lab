import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { MapView, useVisiblePairs } from "../map/MapView.tsx";
import { LeftRail, PairEditor } from "../editor/PairEditor.tsx";
import { PairsList } from "../editor/PairsList.tsx";
import { DiffRail } from "../diff/DiffRail.tsx";
import { HistoryStrip } from "../history/HistoryStrip.tsx";
import { GateView } from "../gate/GateView.tsx";
import { ItemsView } from "../items/ItemsView.tsx";
import { SealModal } from "../seal/SealModal.tsx";
import { clearSelection, init, saveAndRerun, selectPair, setTab, useStore, type MobilePanel } from "../store.ts";
import { useLayoutMode } from "../lib/hooks.ts";
import { anyDialogOpen, useDialog } from "../ui/dialog.ts";
import { TopBar, RunStatus, BackendSwitch } from "./TopBar.tsx";
import { ShortcutSheet } from "./ShortcutSheet.tsx";
import { Toasts } from "./Toasts.tsx";
import { NONE } from "../../core/data/catalog.ts";

export function App() {
  const mode = useLayoutMode();
  const tab = useStore((s) => s.tab);
  const sealOpen = useStore((s) => s.sealOpen);
  const shortcuts = useStore((s) => s.shortcuts);
  const pair = useStore((s) => s.pair);
  const itemId = useStore((s) => s.itemId);
  useEffect(() => {
    void init();
  }, []);
  useShortcuts(mode);
  const sheet = mode === "narrow" && tab === "map" && !!pair;
  const inspectorSheet = mode === "narrow" && tab === "items" && !!itemId;
  // While any dialog is open, the rest of the app is inert: no focus, no clicks, no screen-reader browsing.
  const modal = sealOpen || shortcuts || sheet || inspectorSheet;
  return (
    <MotionConfig reducedMotion="user">
      <h1 className="sr-only">Crosstalk: which operations a typed-decision router confuses</h1>
      <div inert={modal} className="h-dvh" data-testid="shell">
        {mode === "narrow" ? (
          <Narrow />
        ) : (
          <div className="grid h-dvh min-w-0 grid-rows-[56px_minmax(0,1fr)_84px] bg-bg">
            <TopBar mode={mode} />
            <main className="relative min-h-0 min-w-0">
              {tab === "map" && <MapLayout mode={mode} />}
              {tab === "gate" && <GateView />}
              {tab === "items" && <ItemsView />}
            </main>
            <footer className="min-w-0 border-t border-line bg-panel" aria-label="Version history">
              <HistoryStrip />
            </footer>
          </div>
        )}
      </div>
      <AnimatePresence>{sheet && pair && <PairSheet key="sheet" a={pair[0]} b={pair[1]} />}</AnimatePresence>
      <SealModal />
      <ShortcutSheet />
      <Toasts />
    </MotionConfig>
  );
}

function MapLayout({ mode }: { mode: "wide" | "medium" }) {
  const drawer = useStore((s) => s.rightDrawer);
  if (mode === "wide")
    return (
      <div className="grid h-full grid-cols-[360px_minmax(0,1fr)_340px]">
        <aside className="min-h-0 border-r border-line bg-panel" aria-label="Top confusions and pair editor">
          <LeftRail />
        </aside>
        <section className="grid-bg relative min-h-0 min-w-0" aria-label="Confusion map">
          <MapView />
        </section>
        <aside className="min-h-0 border-l border-line bg-panel" aria-label="Since last run">
          <DiffRail />
        </aside>
      </div>
    );
  return (
    <div className="relative grid h-full grid-cols-[300px_minmax(0,1fr)] lg:grid-cols-[320px_minmax(0,1fr)]">
      <aside className="min-h-0 border-r border-line bg-panel" aria-label="Top confusions and pair editor">
        <LeftRail />
      </aside>
      <section className="grid-bg relative min-h-0 min-w-0" aria-label="Confusion map">
        <MapView />
      </section>
      <AnimatePresence>
        {drawer && (
          <motion.aside
            className="absolute inset-y-0 right-0 z-20 w-[340px] max-w-full border-l border-line-2 bg-panel shadow-[-30px_0_80px_-20px_rgb(0_0_0/0.8)]"
            initial={{ x: 360 }}
            animate={{ x: 0 }}
            exit={{ x: 360 }}
            transition={{ type: "spring", stiffness: 320, damping: 34 }}
            aria-label="Since last run"
          >
            <DiffRail />
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  );
}

function Narrow() {
  const tab = useStore((s) => s.tab);
  const panel = useStore((s) => s.mobilePanel);
  return (
    <div className="h-dvh overflow-y-auto overflow-x-hidden bg-bg" data-testid="narrow">
      <TopBar mode="narrow" />
      <main>
        {tab === "map" && (
          <>
            <section className="grid-bg relative aspect-square w-full border-b border-line" aria-label="Confusion map">
              <MapView compact />
            </section>
            <div className="flex items-center justify-between gap-2 border-b border-line bg-panel px-3 py-2">
              <RunStatus compact />
              <BackendSwitch compact />
            </div>
            <div className="sticky top-14 z-20 flex border-b border-line bg-panel/95 px-2 backdrop-blur" role="tablist" aria-label="Panels">
              {(["pair", "diff", "history"] as MobilePanel[]).map((p) => (
                <button
                  key={p}
                  role="tab"
                  aria-selected={panel === p}
                  onClick={() => useStore.setState({ mobilePanel: p })}
                  className={`mono relative min-h-11 flex-1 text-[11px] uppercase tracking-[0.14em] ${panel === p ? "text-text" : "text-muted"}`}
                  data-testid={`mpanel-${p}`}
                >
                  {p}
                  {panel === p && <motion.span layoutId="mpanel" className="absolute inset-x-6 bottom-0 h-[2px] rounded-full bg-signal" />}
                </button>
              ))}
            </div>
            <div className="min-h-[60dvh] bg-panel">
              {panel === "pair" && <PairsList />}
              {panel === "diff" && <DiffRail />}
              {panel === "history" && <HistoryStrip compact />}
            </div>
          </>
        )}
        {tab === "gate" && <GateView />}
        {tab === "items" && (
          <div className="h-[calc(100dvh-56px)]">
            <ItemsView />
          </div>
        )}
      </main>
    </div>
  );
}

/** Phone: the pair editor as a bottom sheet dialog, above the (inert) app. */
function PairSheet({ a, b }: { a: string; b: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialog(true, ref, () => clearSelection());
  return createPortal(
    <>
      <motion.div className="fixed inset-0 z-40 bg-black/60" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => clearSelection()} />
      <motion.div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={`Pair editor: ${a} and ${b === NONE ? "NO MATCH" : b}`}
        tabIndex={-1}
        className="fixed inset-x-0 bottom-0 z-50 flex max-h-[88dvh] flex-col rounded-t-2xl border-t border-line-2 bg-panel outline-none"
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", stiffness: 320, damping: 34 }}
        data-testid="bottom-sheet"
      >
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-line-2" />
        <PairEditor a={a} b={b} phone />
      </motion.div>
    </>,
    document.body,
  );
}

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT" || t.tagName === "SELECT" || t.isContentEditable);
}

function useShortcuts(mode: "wide" | "medium" | "narrow") {
  const { visible } = useVisiblePairs();
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const s = useStore.getState();
      const phoneSheet = mode === "narrow" && s.tab === "map" && !!s.pair;
      // Ctrl/⌘+S saves from the editor, including the phone sheet, but never behind the seal or shortcut dialogs.
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (s.sealOpen || s.shortcuts) return;
        void saveAndRerun();
        return;
      }
      // Any open dialog owns the keyboard (it handles Escape and Tab itself).
      if (anyDialogOpen() || s.sealOpen || s.shortcuts || phoneSheet) return;
      if (e.key === "Escape") {
        if (s.itemId) return useStore.setState({ itemId: null });
        if (s.exportOpen || s.moreOpen) return useStore.setState({ exportOpen: false, moreOpen: false });
        if (!isTyping(e) || s.pair) clearSelection();
        return;
      }
      if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "?") {
        useStore.setState({ shortcuts: true });
      } else if (e.key === "[" || e.key === "]") {
        if (!visible.length) return;
        if (s.tab !== "map") setTab("map");
        const keyOf = (p: [string, string]) => (p[0] < p[1] ? `${p[0]}|${p[1]}` : `${p[1]}|${p[0]}`);
        const i = s.pair ? visible.findIndex((p) => p.key === keyOf(s.pair!)) : -1;
        const next = e.key === "]" ? (i + 1) % visible.length : i <= 0 ? visible.length - 1 : i - 1;
        const p = visible[next]!;
        const [a, b] = p.a === NONE ? [p.b, p.a] : [p.a, p.b];
        selectPair(a, b);
        useStore.setState({ hoverPair: null });
      } else if (e.key === "1") setTab("map");
      else if (e.key === "2") setTab("gate");
      else if (e.key === "3") setTab("items");
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [visible, mode]);
}
