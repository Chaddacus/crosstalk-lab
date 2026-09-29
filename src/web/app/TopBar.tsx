import { AnimatePresence, motion } from "motion/react";
import { TEST_SHA_SHORT } from "../data.ts";
import { useAnalysis } from "../analysis.ts";
import { setBackend, setTab, useStore, type BackendChoice, type Tab } from "../store.ts";
import { usd } from "../lib/format.ts";
import { Padlock } from "../seal/Padlock.tsx";
import { ExportMenu } from "./ExportMenu.tsx";

const TABS: { id: Tab; label: string }[] = [
  { id: "map", label: "Map" },
  { id: "gate", label: "Gate" },
  { id: "items", label: "Items" },
];

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden>
        <circle cx="16" cy="16" r="11" fill="none" stroke="var(--line-2)" strokeWidth="2" />
        <path d="M7.5 19.5 C 12 7, 20 25, 24.5 12.5" fill="none" stroke="var(--signal)" strokeWidth="2.4" strokeLinecap="round" />
        <circle cx="7.5" cy="19.5" r="2.2" fill="var(--post)" />
        <circle cx="24.5" cy="12.5" r="2.2" fill="var(--err)" />
      </svg>
      {!compact && (
        <div className="leading-none">
          <div className="mono text-[13px] font-semibold tracking-[0.22em] text-text">CROSSTALK</div>
        </div>
      )}
    </div>
  );
}

export function Tabs({ size = "md" }: { size?: "sm" | "md" }) {
  const tab = useStore((s) => s.tab);
  return (
    <nav className="flex items-center gap-1" aria-label="Views" role="tablist">
      {TABS.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={tab === t.id}
          onClick={() => setTab(t.id)}
          className={`mono relative rounded-md px-2.5 ${size === "sm" ? "py-1 text-[10.5px]" : "py-1.5 text-[11.5px]"} tracking-[0.14em] uppercase transition-colors ${
            tab === t.id ? "text-text" : "text-muted hover:text-text"
          }`}
          data-testid={`tab-${t.id}`}
        >
          {t.label}
          {tab === t.id && (
            <motion.span layoutId="tab-underline" className="absolute inset-x-2 -bottom-[9px] h-[2px] rounded-full bg-signal" transition={{ type: "spring", stiffness: 400, damping: 34 }} />
          )}
        </button>
      ))}
    </nav>
  );
}

export function RunStatus({ compact = false }: { compact?: boolean }) {
  const active = useStore((s) => s.active);
  const { run } = useAnalysis();
  const total = active?.total ?? run?.results.length ?? 0;
  const done = active ? active.done : (run?.results.length ?? 0);
  const frac = total ? done / total : 0;
  const segs = 12;
  return (
    <div className="flex items-center gap-2" data-testid="run-status" data-done={done} data-total={total} data-running={active ? "1" : "0"}>
      {!compact && <span className="eyebrow !text-[9.5px]">{active?.split === "test" ? "test" : "run"}</span>}
      <div className="flex gap-[2px]" aria-hidden>
        {Array.from({ length: compact ? 6 : segs }, (_, i) => {
          const n = compact ? 6 : segs;
          const on = frac >= (i + 1) / n - 1e-9;
          return <span key={i} className={`h-2.5 w-1 rounded-[1px] transition-colors ${on ? (active ? "bg-signal" : "bg-muted") : "bg-line-2"}`} />;
        })}
      </div>
      <span className="num text-[11.5px] text-text">
        {done}/{total}
      </span>
    </div>
  );
}

export function BackendSwitch({ compact = false }: { compact?: boolean }) {
  const backend = useStore((s) => s.backend);
  const health = useStore((s) => s.health);
  const active = useStore((s) => s.active);
  const liveOk = !!health?.live;
  const opts: { id: BackendChoice; label: string }[] = [
    { id: "mock", label: "Mock" },
    { id: "replay", label: "Replay" },
    { id: "live", label: "Live" },
  ];
  return (
    <div className="relative flex items-center rounded-lg border border-line bg-bg p-0.5" role="radiogroup" aria-label="Backend" data-testid="backend-switch">
      {opts.map((o) => {
        const disabled = (o.id === "live" && !liveOk) || (!!active && o.id !== backend);
        const tip = o.id === "live" && !liveOk ? "Run `npm run live` with an API key set" : o.id === "live" ? `${health?.model} via the local server` : undefined;
        return (
          <span key={o.id} title={tip} data-testid={`backend-${o.id}-wrap`} className="relative">
            <button
              role="radio"
              aria-checked={backend === o.id}
              aria-disabled={disabled}
              disabled={disabled}
              onClick={() => void setBackend(o.id)}
              className={`mono relative z-10 rounded-md ${compact ? "px-1.5 py-1 text-[9.5px]" : "px-2.5 py-1 text-[10.5px]"} uppercase tracking-[0.12em] transition-colors disabled:cursor-not-allowed ${
                backend === o.id ? "text-bg" : disabled ? "text-faint/70" : "text-muted hover:text-text"
              }`}
              data-testid={`backend-${o.id}`}
            >
              {backend === o.id && (
                <motion.span
                  layoutId="backend-pill"
                  className={`absolute inset-0 -z-10 rounded-md ${o.id === "mock" ? "bg-post" : o.id === "live" ? "bg-signal" : "bg-muted"}`}
                  transition={{ type: "spring", stiffness: 420, damping: 34 }}
                />
              )}
              {o.label}
            </button>
          </span>
        );
      })}
    </div>
  );
}

export function SealButton({ compact = false }: { compact?: boolean }) {
  const seal = useStore((s) => s.seal);
  const peeks = seal.ledger.length;
  return (
    <button
      className={`group flex items-center gap-2 rounded-lg border px-2.5 py-1.5 transition-colors ${
        seal.status === "done" ? "border-post/40 bg-post/10 hover:border-post/70" : "border-line hover:border-line-2 hover:bg-panel-2"
      }`}
      onClick={() => useStore.setState({ sealOpen: true })}
      data-testid="seal-button"
      aria-label={`Test set sealed, ${peeks} peeks. Open the seal.`}
    >
      <Padlock open={seal.status === "done"} size={14} />
      {!compact && (
        <span className="mono whitespace-nowrap text-[10.5px] tracking-[0.1em] text-muted group-hover:text-text">
          {seal.status === "done" ? "TEST OPENED" : "TEST SEALED"} <span className="text-faint">{TEST_SHA_SHORT}…</span>
        </span>
      )}
      <span className="mono whitespace-nowrap rounded bg-panel-3 px-1.5 py-0.5 text-[10px] text-text" data-testid="peeks" data-count={peeks}>
        peeks{" "}
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span key={peeks} className="num inline-block" initial={{ y: -8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 8, opacity: 0 }}>
            {peeks}
          </motion.span>
        </AnimatePresence>
      </span>
    </button>
  );
}

export function Spend() {
  const backend = useStore((s) => s.backend);
  const health = useStore((s) => s.health);
  const { run } = useAnalysis();
  if (backend === "live")
    return (
      <div className="mono text-[11px] text-muted" data-testid="spend">
        spent <span className="num text-text">{usd(health?.spentUsd ?? 0)}</span>
        <span className="text-faint"> / cap {usd(health?.budgetUsd ?? 0)}</span>
      </div>
    );
  return (
    <div className="mono text-[11px] text-muted" title="No money is spent in MOCK or REPLAY. The estimate is what one dev rerun would cost at Jev list price ($0.042 per million input tokens), using characters ÷ 4 as tokens." data-testid="spend">
      <span className="num text-text">$0.000</span> spent
      <span className="sr-only"> · a live dev rerun is estimated at {run && run.runHash ? usd(run.costUsd) : "—"}</span>
    </div>
  );
}

export function TopBar({ mode }: { mode: "wide" | "medium" | "narrow" }) {
  const drawer = useStore((s) => s.rightDrawer);
  const tab = useStore((s) => s.tab);
  if (mode === "narrow") {
    return (
      <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line bg-panel/95 px-3 backdrop-blur">
        <Logo compact />
        <Tabs size="sm" />
        <div className="ml-auto flex items-center gap-1.5">
          <SealButton compact />
        </div>
      </header>
    );
  }
  return (
    <header className="relative z-30 flex h-14 items-center gap-5 border-b border-line bg-panel px-4">
      <Logo />
      <span className="h-5 w-px bg-line-2" />
      <Tabs />
      <div className="ml-auto flex items-center gap-4">
        <RunStatus />
        {mode === "wide" && <Spend />}
        <SealButton compact={mode !== "wide"} />
        <BackendSwitch />
        <ExportMenu />
        {mode === "medium" && tab === "map" && (
          <button className="btn h-8" onClick={() => useStore.setState({ rightDrawer: !drawer })} aria-expanded={drawer} data-testid="drawer-toggle">
            Diff
          </button>
        )}
        <HelpButton />
      </div>
    </header>
  );
}

function HelpButton() {
  return (
    <button className="btn btn-ghost h-8 w-8 px-0" onClick={() => useStore.setState({ shortcuts: true })} aria-label="Keyboard shortcuts" data-testid="help">
      <span className="mono text-[13px]">?</span>
    </button>
  );
}
