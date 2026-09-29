import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PairLeak } from "../../core/eval/leakage.ts";
import { NONE } from "../../core/data/catalog.ts";
import { deleteOps, devById, ops, opsById, catalog, SPEC_SHORT, devItems } from "../data.ts";
import { useAnalysis } from "../analysis.ts";
import { selectPair, setTopK, useStore, clearSelection } from "../store.ts";
import { arcPath, buildRing, chordPath, placeLabels, polar, spokePath, type RingLayout } from "./layout.ts";
import { BackgroundCanvas } from "./BackgroundCanvas.tsx";
import { HoverCard } from "./HoverCard.tsx";
import { BackendChip } from "../ui/BackendChip.tsx";
import { methodColor } from "../ui/MethodBadge.tsx";

const layout: RingLayout = buildRing(ops);

/**
 * Width = 1 + 10·√(M / M_max), clamped to [1, 11] px, then scaled with the ring so a small map
 * keeps the proportions of a large one. Spokes to the hub are drawn at 60%.
 */
export function chordWidth(mass: number, maxMass: number, R = 360, hub = false): number {
  const base = Math.min(11, Math.max(1, 1 + 10 * Math.sqrt(mass / Math.max(maxMass, 1e-9))));
  const k = Math.min(1, Math.max(0.32, R / 420)) * (hub ? 0.6 : 1);
  return Math.max(1, 1 + (base - 1) * k);
}

/** The pairs drawn as interactive SVG chords (top-K after the DELETE filter). */
export function useVisiblePairs() {
  const { leak } = useAnalysis();
  const topK = useStore((s) => s.topK);
  const deleteOnly = useStore((s) => s.deleteOnly);
  return useMemo(() => {
    const pairs = (leak?.pairs ?? []).filter((p) => !deleteOnly || deleteOps.has(p.a) || deleteOps.has(p.b));
    return { all: pairs, visible: pairs.slice(0, topK), maxMass: leak?.pairs[0]?.mass ?? 1 };
  }, [leak, topK, deleteOnly]);
}

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

export function MapView({ compact = false }: { compact?: boolean }) {
  const [ref, { w, h }] = useSize<HTMLDivElement>();
  const { leak, run } = useAnalysis();
  const { visible, all, maxMass } = useVisiblePairs();
  const pair = useStore((s) => s.pair);
  const focusOp = useStore((s) => s.focusOp);
  const hoverPair = useStore((s) => s.hoverPair);
  const active = useStore((s) => s.active);
  const [hoverOp, setHoverOp] = useState<string | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [kbOp, setKbOp] = useState<string | null>(null);

  const showLabels = w >= 560 && !compact;
  const cx = w / 2;
  const cy = h / 2;
  const S = Math.min(w, h);
  const R = Math.max(40, showLabels ? Math.min(S * 0.36, w / 2 - 158, h / 2 - 72) : compact ? S * 0.37 : S * 0.4);
  const hubR = Math.max(22, R * 0.14);

  const selectedKey = pair ? (pair[0] < pair[1] ? `${pair[0]}|${pair[1]}` : `${pair[1]}|${pair[0]}`) : null;
  const drawn = useMemo(() => {
    const extra = all.filter(
      (p) => !visible.includes(p) && ((focusOp && (p.a === focusOp || p.b === focusOp)) || p.key === selectedKey),
    );
    return extra.length ? [...visible, ...extra.slice(0, 30)] : visible;
  }, [visible, all, focusOp, selectedKey]);

  const bgPairs = useMemo(() => {
    const vis = new Set(drawn.map((p) => p.key));
    return all.filter((p) => !vis.has(p.key) && p.mass >= 0.03).slice(0, 900);
  }, [all, drawn]);

  // Pinned labels: endpoints of the top 3 non-hub chords, plus the selected pair.
  const pinned = useMemo(() => {
    const ids = new Set<string>();
    for (const p of visible.filter((x) => !x.hub).slice(0, 3)) {
      ids.add(p.a);
      ids.add(p.b);
    }
    if (pair) for (const o of pair) if (o !== NONE) ids.add(o);
    return [...ids];
  }, [visible, pair]);

  const labels = useMemo(() => {
    if (!showLabels) return [];
    const items = [
      ...layout.families.map((f) => ({ key: `f:${f.name}`, text: f.name, sub: String(f.count), angle: f.mid })),
      ...pinned.map((id) => ({ key: `o:${id}`, text: id, angle: layout.ops.get(id)!.angle })),
    ];
    return placeLabels(items, R + 26, R + 42, 13, h / 2 - 40);
  }, [showLabels, pinned, R, h]);

  const top3 = visible
    .filter((p) => p.state === "error")
    .slice(0, 3)
    .map((p) => `${p.a} ⇄ ${p.b} (${p.mass.toFixed(2)})`)
    .join("; ");
  const ariaLabel = `Confusion map of ${ops.length} Twilio operations in ${layout.families.length} families. ${
    leak ? `Top confusions: ${top3 || "none yet"}.` : "Running."
  }`;

  const hovered: PairLeak | undefined = hoverPair ? drawn.find((p) => p.key === hoverPair) : undefined;
  const dimOthers = !!(selectedKey || focusOp);
  const softDim = !dimOthers && !!hoverPair;

  // keyboard: arrows move an operation cursor around the ring; Enter focuses it
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Enter" && e.key !== "Escape") return;
    const order = layout.order;
    if (e.key === "Escape") {
      setKbOp(null);
      clearSelection();
      return;
    }
    if (e.key === "Enter" && kbOp) {
      focusOperation(kbOp, all);
      return;
    }
    const i = kbOp ? order.indexOf(kbOp) : -1;
    const next = e.key === "ArrowRight" ? order[(i + 1) % order.length]! : order[(i - 1 + order.length) % order.length]!;
    setKbOp(next);
    e.preventDefault();
  }

  const labelOp = hoverOp ?? kbOp;

  return (
    <div
      ref={ref}
      className="relative h-full w-full select-none overflow-hidden outline-none"
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerMove={(e) => {
        const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
        setCursor({ x: e.clientX - r.left, y: e.clientY - r.top });
      }}
      onPointerLeave={() => {
        setCursor(null);
        setHoverOp(null);
        useStore.setState({ hoverPair: null });
      }}
      aria-label="Confusion map. Arrow keys move between operations; Enter focuses one."
    >
      {/* soft radial glow behind the ring */}
      <div
        className="pointer-events-none absolute"
        style={{
          left: cx - R * 1.5,
          top: cy - R * 1.5,
          width: R * 3,
          height: R * 3,
          background: "radial-gradient(closest-side, rgb(61 214 208 / 0.07), rgb(61 214 208 / 0.02) 55%, transparent 72%)",
        }}
      />
      {w > 0 && (
        <BackgroundCanvas layout={layout} pairs={bgPairs} width={w} height={h} cx={cx} cy={cy} R={R} hubR={hubR} dim={dimOthers} maxMass={maxMass} />
      )}
      {w > 0 && (
        <svg width={w} height={h} className="absolute inset-0" role="img" aria-label={ariaLabel} data-testid="map">
          <defs>
            <filter id="ct-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3.2" />
            </filter>
            <radialGradient id="ct-hub" cx="50%" cy="45%" r="60%">
              <stop offset="0%" stopColor="#18212a" />
              <stop offset="100%" stopColor="#0a0e12" />
            </radialGradient>
          </defs>
          <g transform={`translate(${cx},${cy})`}>
            <FamilyArcs R={R} />
            <g data-testid="chords">
              {[...drawn]
                .sort((a, b) => rankState(a) - rankState(b) || a.mass - b.mass)
                .map((p) => (
                  <Chord
                    key={p.key}
                    p={p}
                    R={R}
                    hubR={hubR}
                    maxMass={maxMass}
                    rank={visible.indexOf(p)}
                    dim={dimOthers && p.key !== selectedKey && p.key !== hoverPair && !(focusOp && (p.a === focusOp || p.b === focusOp))}
                    soft={softDim && p.key !== hoverPair}
                    hot={p.key === hoverPair || p.key === selectedKey}
                  />
                ))}
            </g>
            <Ticks R={R} hoverOp={labelOp} pair={pair} focusOp={focusOp} onHover={setHoverOp} all={all} />
            <Hub R={hubR} leakIn={leak?.byOption.get(NONE) ?? 0} />
            {showLabels && <Labels labels={labels} R={R} halfW={w / 2} />}
            {labelOp && <OpPill op={labelOp} R={R} />}
          </g>
        </svg>
      )}

      {/* overlays */}
      {!compact && (
      <div className="pointer-events-none absolute left-4 top-3 max-w-[60%]">
        <div className="eyebrow">Twilio REST API · v2010</div>
        <div className="mono mt-1 text-[11px] leading-4 text-faint">
          {ops.length} operations · {catalog.families.length} families · dev {devItems.length} items
          <br />
          spec {SPEC_SHORT}… · twilio-oai@218b782
        </div>
      </div>
      )}
      <div className={`absolute ${compact ? "left-2 top-2" : "right-3 top-3"}`}>
        <BackendChip compact={compact} />
      </div>
      {active && active.split === "dev" && (
        <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2">
          <div className="mono flex items-center gap-2 rounded-full border border-line-2 bg-panel/90 px-3 py-1 text-[11px] text-muted backdrop-blur">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-signal" />
            rerunning dev · {active.done}/{active.total}
          </div>
        </div>
      )}
      <MapControls compact={compact} />
      <AnimatePresence>
        {hovered && run && (
          <HoverCard key={hovered.key} pair={hovered} run={run} {...(cursor ?? anchorFor(hovered, cx, cy, R))} w={w} h={h} />
        )}
      </AnimatePresence>
    </div>
  );
}

/** Where to put the hover card when the pair is hovered from the list (no pointer in the map). */
function anchorFor(p: PairLeak, cx: number, cy: number, R: number) {
  const ids = [p.a, p.b].filter((x) => x !== NONE);
  const angles = ids.map((id) => layout.ops.get(id)!.angle);
  const mid =
    angles.length === 2 ? Math.atan2(Math.sin(angles[0]!) + Math.sin(angles[1]!), Math.cos(angles[0]!) + Math.cos(angles[1]!)) : angles[0]!;
  const [x, y] = polar(cx, cy, R * 0.35, mid);
  return { x, y };
}

function rankState(p: PairLeak) {
  return p.state === "background" ? 0 : p.state === "near" ? 1 : 2;
}

/** Focus an operation: show all its chords, and load it with its biggest leak partner into the editor. */
export function focusOperation(op: string, all: PairLeak[]) {
  const partner = all.find((p) => p.a === op || p.b === op);
  const other = partner ? (partner.a === op ? partner.b : partner.a) : null;
  useStore.setState({ focusOp: op, pair: other ? [op, other] : null, mobilePanel: "pair" });
}

const FamilyArcs = memo(function FamilyArcs({ R }: { R: number }) {
  const reduce = useReducedMotion();
  return (
    <g aria-hidden>
      {layout.families.map((f, i) => (
        <motion.path
          key={f.name}
          d={arcPath(R + 26, f.a0, f.a1)}
          fill="none"
          stroke="var(--line-2)"
          strokeWidth={1.5}
          strokeLinecap="round"
          data-testid="family-arc"
          initial={reduce ? false : { pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 0.35, delay: i * 0.02, ease: "easeOut" }}
        />
      ))}
    </g>
  );
});

function Ticks({
  R,
  hoverOp,
  pair,
  focusOp,
  onHover,
  all,
}: {
  R: number;
  hoverOp: string | null;
  pair: [string, string] | null;
  focusOp: string | null;
  onHover: (op: string | null) => void;
  all: PairLeak[];
}) {
  const reduce = useReducedMotion();
  return (
    <g>
      {layout.order.map((id, i) => {
        const n = layout.ops.get(id)!;
        const del = n.op.method === "DELETE";
        const a = n.angle;
        const [x0, y0] = polar(0, 0, R + 3, a);
        const [x1, y1] = polar(0, 0, R + 13, a);
        const [x2, y2] = polar(0, 0, R + 15.5, a);
        const [x3, y3] = polar(0, 0, R + 21, a);
        const [hx0, hy0] = polar(0, 0, R - 4, a);
        const [hx1, hy1] = polar(0, 0, R + 24, a);
        const inPair = pair?.includes(id) || focusOp === id;
        const hot = hoverOp === id || inPair;
        const faded = (pair || focusOp) && !inPair;
        const color = methodColor(n.op.method);
        return (
          <motion.g
            key={id}
            data-testid="op-tick"
            data-op={id}
            data-method={n.op.method}
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: faded ? 0.3 : 1 }}
            transition={{ duration: 0.3, delay: reduce ? 0 : Math.min(0.6, i * 0.003) }}
            onPointerEnter={() => onHover(id)}
            onPointerLeave={() => onHover(null)}
            onClick={(e) => {
              e.stopPropagation();
              focusOperation(id, all);
            }}
            style={{ cursor: "pointer" }}
          >
            <line x1={hx0} y1={hy0} x2={hx1} y2={hy1} stroke="transparent" strokeWidth={6} />
            <line x1={x0} y1={y0} x2={x1} y2={y1} stroke={color} strokeWidth={hot ? 2.6 : 1.6} strokeLinecap="round" opacity={hot ? 1 : 0.8} />
            {del && <line x1={x2} y1={y2} x2={x3} y2={y3} stroke={color} strokeWidth={hot ? 2.6 : 1.6} strokeLinecap="round" opacity={hot ? 1 : 0.8} />}
            {n.op.empty && <circle cx={polar(0, 0, R - 5, a)[0]} cy={polar(0, 0, R - 5, a)[1]} r={0.9} fill="var(--faint)" />}
          </motion.g>
        );
      })}
    </g>
  );
}

function Hub({ R, leakIn }: { R: number; leakIn: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.g
      data-testid="hub"
      initial={reduce ? false : { scale: 0.6, opacity: 0 }}
      animate={{ scale: [0.6, 1.08, 1], opacity: 1 }}
      transition={{ duration: 0.9, delay: reduce ? 0 : 0.5, times: [0, 0.6, 1] }}
    >
      <circle r={R + 6} fill="none" stroke="var(--line)" strokeDasharray="2 4" />
      <circle r={R} fill="url(#ct-hub)" stroke="var(--line-2)" />
      <text textAnchor="middle" y={R < 30 ? 0 : -1} dy={R < 30 ? "0.34em" : 0} className="mono" fontSize={R < 30 ? 7.5 : Math.min(11, R * 0.2)} letterSpacing="0.1em" fill="var(--muted)">
        NO MATCH
      </text>
      {R >= 30 && (
        <text textAnchor="middle" y={Math.max(11, R * 0.36)} className="mono" fontSize={Math.min(10.5, R * 0.18)} fill="var(--faint)">
          leak {leakIn.toFixed(1)}
        </text>
      )}
    </motion.g>
  );
}

interface ChordProps {
  p: PairLeak;
  R: number;
  hubR: number;
  maxMass: number;
  rank: number;
  dim: boolean;
  soft?: boolean;
  hot: boolean;
}

const Chord = memo(function Chord({ p, R, hubR, maxMass, rank, dim, soft = false, hot }: ChordProps) {
  const reduce = useReducedMotion();
  const d = useMemo(() => {
    if (p.hub) return spokePath(layout, p.a === NONE ? p.b : p.a, R, hubR);
    return chordPath(layout, p.a, p.b, R);
  }, [p.a, p.b, p.hub, R, hubR]);
  const width = chordWidth(p.mass, maxMass, R, p.hub);
  const color = p.state === "error" ? "var(--err)" : p.state === "near" ? "var(--near)" : "var(--bgchord)";
  const baseOpacity = p.state === "error" ? (p.hub ? 0.7 : 0.88) : p.state === "near" ? 0.7 : 0.42;
  const opacity = dim ? 0.2 * baseOpacity : hot ? 1 : soft ? 0.4 * baseOpacity : baseOpacity;
  // flash a green ring once when a chord loses all its errors
  const prevState = useRef(p.state);
  const [flash, setFlash] = useState(0);
  useEffect(() => {
    if (prevState.current === "error" && p.state !== "error") setFlash((f) => f + 1);
    prevState.current = p.state;
  }, [p.state]);
  const spring = reduce ? { duration: 0 } : { type: "spring" as const, stiffness: 110, damping: 18 };
  const introDelay = rank >= 0 ? 0.6 + Math.min(rank, 40) * 0.012 : 0;
  return (
    <g
      data-testid="chord"
      data-pair={p.key}
      data-state={p.state}
      data-mass={p.mass.toFixed(4)}
      data-hub={p.hub ? "1" : "0"}
      style={{ cursor: "pointer" }}
      onPointerEnter={() => useStore.setState({ hoverPair: p.key })}
      onPointerLeave={() => useStore.setState({ hoverPair: null })}
      onClick={(e) => {
        e.stopPropagation();
        const [a, b] = p.a === NONE ? [p.b, p.a] : [p.a, p.b];
        useStore.setState({ focusOp: null });
        selectPair(a, b);
      }}
    >
      {p.state === "error" && (
        <motion.path
          d={d}
          fill="none"
          stroke="var(--err)"
          filter="url(#ct-glow)"
          initial={false}
          animate={{ strokeWidth: width + (hot ? 7 : 4), opacity: dim ? 0.04 : hot ? 0.75 : soft ? 0.1 : 0.32 }}
          transition={spring}
          pointerEvents="none"
        />
      )}
      {p.state === "near" ? (
        <motion.path
          d={d}
          fill="none"
          stroke={color}
          strokeDasharray="5 4"
          strokeLinecap="round"
          initial={reduce ? false : { opacity: 0 }}
          animate={{ strokeWidth: width, opacity }}
          transition={{ strokeWidth: spring, opacity: { duration: reduce ? 0.15 : 0.5, delay: reduce ? 0 : introDelay } }}
          pointerEvents="none"
        />
      ) : (
        <motion.path
          d={d}
          fill="none"
          stroke={color}
          strokeLinecap="round"
          initial={reduce ? false : { pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, strokeWidth: width, opacity }}
          transition={{
            pathLength: { duration: 0.9, delay: introDelay, ease: [0.22, 1, 0.36, 1] },
            opacity: { duration: 0.3, delay: reduce ? 0 : introDelay },
            strokeWidth: spring,
          }}
          pointerEvents="none"
        />
      )}
      <AnimatePresence>
        {flash > 0 && (
          <motion.path
            key={flash}
            d={d}
            fill="none"
            stroke="var(--fixed)"
            strokeLinecap="round"
            initial={{ opacity: 0.95, strokeWidth: width + 6 }}
            animate={{ opacity: 0, strokeWidth: width + 14 }}
            transition={{ duration: reduce ? 0.15 : 1.1, ease: "easeOut" }}
            onAnimationComplete={() => setFlash(0)}
            pointerEvents="none"
          />
        )}
      </AnimatePresence>
      <path d={d} fill="none" stroke="transparent" strokeWidth={Math.max(10, width + 6)} />
    </g>
  );
});

function Labels({ labels, R, halfW }: { labels: ReturnType<typeof placeLabels>; R: number; halfW: number }) {
  return (
    <g pointerEvents="none">
      {labels.map((l) => {
        const isOp = l.key.startsWith("o:");
        const op = isOp ? opsById.get(l.text) : undefined;
        const [tx, ty] = isOp ? polar(0, 0, R + (op?.method === "DELETE" ? 23 : 15), l.angle) : [l.anchorX, l.anchorY];
        const elbowX = l.side === "right" ? l.x - 6 : l.x + 6;
        const charW = isOp ? 6.35 : 6.1;
        const room = Math.max(4, Math.floor((halfW - Math.abs(l.x) - 10) / charW) - (l.sub ? l.sub.length + 1 : 0));
        const full = isOp ? l.text : l.text.toUpperCase();
        const text = full.length > room ? full.slice(0, Math.max(3, room - 1)) + "…" : full;
        return (
          <motion.g key={l.key} initial={false} animate={{ opacity: 1 }} data-testid={isOp ? "op-label" : "family-label"}>
            <motion.path
              initial={false}
              animate={{ d: `M${tx},${ty}L${elbowX},${l.y}L${l.side === "right" ? l.x - 2 : l.x + 2},${l.y}` }}
              transition={{ type: "spring", stiffness: 160, damping: 22 }}
              fill="none"
              stroke={isOp ? "var(--muted)" : "var(--line-2)"}
              strokeWidth={isOp ? 0.9 : 0.8}
              opacity={isOp ? 0.7 : 1}
            />
            <motion.text
              initial={false}
              animate={{ x: l.x, y: l.y }}
              transition={{ type: "spring", stiffness: 160, damping: 22 }}
              dy="0.34em"
              textAnchor={l.side === "right" ? "start" : "end"}
              className="mono"
              fontSize={isOp ? 10.5 : 9.5}
              letterSpacing={isOp ? "0" : "0.06em"}
              fill={isOp ? "var(--text)" : "var(--muted)"}
            >
              {text}
              {text !== full && <title>{full}</title>}
              {l.sub && (
                <tspan fill="var(--faint)" dx={5}>
                  {l.sub}
                </tspan>
              )}
            </motion.text>
          </motion.g>
        );
      })}
    </g>
  );
}

function OpPill({ op, R }: { op: string; R: number }) {
  const n = layout.ops.get(op);
  if (!n) return null;
  const a = n.angle;
  const right = Math.sin(a) >= 0;
  const [x, y] = polar(0, 0, R + 30, a);
  const text = `${n.op.method} ${op}`;
  const wpx = text.length * 6.4 + 16;
  return (
    <g pointerEvents="none" data-testid="op-pill">
      <rect x={right ? x : x - wpx} y={y - 10} width={wpx} height={20} rx={6} fill="var(--panel-3)" stroke="var(--line-2)" />
      <text x={right ? x + 8 : x - wpx + 8} y={y} dy="0.34em" className="mono" fontSize={10.5} fill="var(--text)">
        <tspan fill={methodColor(n.op.method)}>{n.op.method}</tspan> {op}
      </text>
    </g>
  );
}

function MapControls({ compact }: { compact: boolean }) {
  const topK = useStore((s) => s.topK);
  const deleteOnly = useStore((s) => s.deleteOnly);
  return (
    <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-center gap-x-5 gap-y-2 px-4 pb-3 pt-2 text-[11px] text-muted">
      {!compact && (
        <div className="flex items-center gap-3" aria-label="Legend">
          <LegendLine kind="error" label="error" />
          <LegendLine kind="near" label="near-miss" />
          <LegendLine kind="background" label="background" />
          <span className="mx-1 h-3 w-px bg-line-2" />
          <span className="flex items-center gap-1.5">
            <i className="inline-block h-2.5 w-[2px] rounded bg-get" /> GET
          </span>
          <span className="flex items-center gap-1.5">
            <i className="inline-block h-2.5 w-[2px] rounded bg-post" /> POST
          </span>
          <span className="flex items-center gap-1.5">
            <svg width="4" height="14" aria-hidden>
              <line x1="2" y1="1" x2="2" y2="8" stroke="var(--delete)" strokeWidth="2" strokeLinecap="round" />
              <line x1="2" y1="10.5" x2="2" y2="13" stroke="var(--delete)" strokeWidth="2" strokeLinecap="round" />
            </svg>
            DELETE
          </span>
        </div>
      )}
      <div className="ml-auto flex items-center gap-4">
        <label className="flex items-center gap-2">
          <span className="eyebrow !text-[10px]">Top</span>
          <input
            type="range"
            className="range w-24"
            min={10}
            max={200}
            step={5}
            value={topK}
            onChange={(e) => setTopK(Number(e.target.value))}
            aria-label="Number of chords shown"
            data-testid="topk"
          />
          <span className="num w-7 text-right text-text">{topK}</span>
        </label>
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={deleteOnly}
            onChange={(e) => useStore.setState({ deleteOnly: e.target.checked })}
            className="h-3.5 w-3.5 accent-[var(--delete)]"
            data-testid="delete-only"
          />
          <span>DELETE only</span>
        </label>
      </div>
    </div>
  );
}

function LegendLine({ kind, label }: { kind: "error" | "near" | "background"; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <svg width="22" height="8" aria-hidden>
        {kind === "error" && <line x1="1" y1="4" x2="21" y2="4" stroke="var(--err)" strokeWidth="5" opacity="0.35" filter="url(#ct-glow)" />}
        <line
          x1="1"
          y1="4"
          x2="21"
          y2="4"
          stroke={kind === "error" ? "var(--err)" : kind === "near" ? "var(--near)" : "var(--bgchord)"}
          strokeWidth={kind === "background" ? 1.2 : 2}
          strokeDasharray={kind === "near" ? "4 3" : undefined}
          strokeLinecap="round"
        />
      </svg>
      {label}
    </span>
  );
}

export { layout as ringLayout, devById };
