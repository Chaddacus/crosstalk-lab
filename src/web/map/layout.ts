/**
 * Ring layout for hierarchical edge bundling: root → family → operation.
 * d3.cluster over [2π, 1]; separation 1 inside a family and 3 between families so families read as arcs.
 * Radii are unit-less here and scaled by R at render time.
 */
import { cluster, hierarchy, type HierarchyPointNode } from "d3-hierarchy";
import { curveBundle, lineRadial } from "d3-shape";
import type { Operation } from "../../core/data/catalog.ts";

interface Datum {
  name: string;
  op?: Operation;
  children?: Datum[];
}

export interface OpNode {
  op: Operation;
  angle: number;
  node: HierarchyPointNode<Datum>;
  index: number;
}

export interface FamilyArc {
  name: string;
  count: number;
  a0: number;
  a1: number;
  mid: number;
}

export interface RingLayout {
  ops: Map<string, OpNode>;
  order: string[];
  families: FamilyArc[];
  slot: number;
}

/** Internal node radius (unit) for families; lower pulls bundles toward the center. */
const FAMILY_RADIUS = 0.56;

export function buildRing(ops: Operation[]): RingLayout {
  const families: string[] = [];
  for (const o of ops) if (!families.includes(o.family)) families.push(o.family);
  const root = hierarchy<Datum>({
    name: "root",
    children: families.map((f) => ({ name: f, children: ops.filter((o) => o.family === f).map((op) => ({ name: op.id, op })) })),
  });
  const laid = cluster<Datum>()
    .size([2 * Math.PI, 1])
    .separation((a, b) => (a.parent === b.parent ? 1 : 3))(root);
  laid.each((n) => {
    if (n.depth === 1) n.y = FAMILY_RADIUS;
    if (n.depth === 0) n.y = 0;
  });
  const leaves = laid.leaves();
  const map = new Map<string, OpNode>();
  leaves.forEach((n, index) => map.set(n.data.name, { op: n.data.op!, angle: n.x, node: n, index }));
  const slot = leaves.length > 1 ? leaves[1]!.x - leaves[0]!.x : 0.05;
  const fams: FamilyArc[] = (laid.children ?? []).map((f) => {
    const ls = f.leaves();
    const a0 = ls[0]!.x - slot * 0.45;
    const a1 = ls[ls.length - 1]!.x + slot * 0.45;
    return { name: f.data.name, count: ls.length, a0, a1, mid: (a0 + a1) / 2 };
  });
  return { ops: map, order: leaves.map((l) => l.data.name), families: fams, slot };
}

/** Polar (angle clockwise from 12 o'clock) to cartesian around (cx, cy). */
export function polar(cx: number, cy: number, r: number, a: number): [number, number] {
  return [cx + r * Math.sin(a), cy - r * Math.cos(a)];
}

/** Bundled chord path between two operations. */
export function chordPath(layout: RingLayout, a: string, b: string, R: number, beta = 0.85): string {
  const na = layout.ops.get(a)?.node;
  const nb = layout.ops.get(b)?.node;
  if (!na || !nb) return "";
  const pts = na.path(nb);
  const line = lineRadial<HierarchyPointNode<Datum>>()
    .curve(curveBundle.beta(beta))
    .radius((d) => d.y * R)
    .angle((d) => d.x);
  return line(pts) ?? "";
}

/** A spoke from an operation tick to the NO MATCH hub: a gentle curve that bends with the family. */
export function spokePath(layout: RingLayout, op: string, R: number, hubR: number): string {
  const n = layout.ops.get(op);
  if (!n) return "";
  const a = n.angle;
  const [x0, y0] = polar(0, 0, R, a);
  const [x1, y1] = polar(0, 0, hubR + 2, a + 0.08);
  const [cx, cy] = polar(0, 0, R * 0.5, a + 0.02);
  return `M${x0.toFixed(2)},${y0.toFixed(2)}Q${cx.toFixed(2)},${cy.toFixed(2)} ${x1.toFixed(2)},${y1.toFixed(2)}`;
}

/** Arc path (for family arcs) between angles at radius r, centered on the origin. */
export function arcPath(r: number, a0: number, a1: number): string {
  const [x0, y0] = polar(0, 0, r, a0);
  const [x1, y1] = polar(0, 0, r, a1);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${x0.toFixed(2)},${y0.toFixed(2)}A${r},${r} 0 ${large} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
}

export interface PlacedLabel {
  key: string;
  text: string;
  sub?: string;
  angle: number;
  side: "left" | "right";
  x: number;
  y: number;
  anchorX: number;
  anchorY: number;
}

/**
 * Pie-style labels: split by side, sort by y, push apart to a minimum spacing, keep inside [top, bottom].
 * Coordinates are relative to the ring center.
 */
export function placeLabels(
  items: { key: string; text: string; sub?: string; angle: number }[],
  rAnchor: number,
  rLabel: number,
  minGap: number,
  halfHeight: number,
): PlacedLabel[] {
  const out: PlacedLabel[] = [];
  for (const side of ["right", "left"] as const) {
    const xs = items
      .filter((it) => (side === "right" ? Math.sin(it.angle) >= 0 : Math.sin(it.angle) < 0))
      .map((it) => {
        const [ax, ay] = polar(0, 0, rAnchor, it.angle);
        const [lx, ly] = polar(0, 0, rLabel, it.angle);
        return { ...it, side, x: lx, y: ly, anchorX: ax, anchorY: ay };
      })
      .sort((p, q) => p.y - q.y);
    // forward pass pushes down, backward pass pushes up, then clamp
    for (let i = 1; i < xs.length; i++) if (xs[i]!.y - xs[i - 1]!.y < minGap) xs[i]!.y = xs[i - 1]!.y + minGap;
    const limit = halfHeight - 6;
    if (xs.length && xs[xs.length - 1]!.y > limit) {
      xs[xs.length - 1]!.y = limit;
      for (let i = xs.length - 2; i >= 0; i--) if (xs[i + 1]!.y - xs[i]!.y < minGap) xs[i]!.y = xs[i + 1]!.y - minGap;
    }
    for (const p of xs) {
      // keep label x on the ring's circle for its final y, so leader lines stay short
      const yy = Math.max(-rLabel, Math.min(rLabel, p.y));
      const xx = Math.sqrt(Math.max(0, rLabel * rLabel - yy * yy));
      p.x = side === "right" ? Math.max(p.x, xx * 0.92) : Math.min(p.x, -xx * 0.92);
      out.push(p);
    }
  }
  return out;
}
