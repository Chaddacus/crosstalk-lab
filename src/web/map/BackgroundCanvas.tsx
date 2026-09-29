/** Faint background leakage on a Canvas layer under the SVG. Not interactive. */
import { useEffect, useRef } from "react";
import type { HierarchyPointNode } from "d3-hierarchy";
import { curveBundle, lineRadial } from "d3-shape";
import type { PairLeak } from "../../core/eval/leakage.ts";
import { NONE } from "../../core/data/catalog.ts";
import { polar, type RingLayout } from "./layout.ts";

interface Props {
  layout: RingLayout;
  pairs: PairLeak[];
  width: number;
  height: number;
  cx: number;
  cy: number;
  R: number;
  hubR: number;
  dim: boolean;
  maxMass: number;
}

export function BackgroundCanvas({ layout, pairs, width, height, cx, cy, R, hubR, dim, maxMass }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.translate(cx, cy);
    ctx.lineCap = "round";
    const line = lineRadial<HierarchyPointNode<unknown>>()
      .curve(curveBundle.beta(0.85))
      .radius((d) => d.y * R)
      .angle((d) => d.x)
      .context(ctx);
    const alpha = dim ? 0.06 : 0.2;
    for (const p of pairs) {
      const w = Math.max(0.6, Math.min(2.2, 0.6 + 3 * Math.sqrt(p.mass / Math.max(maxMass, 1e-9))));
      ctx.beginPath();
      if (p.hub) {
        const op = p.a === NONE ? p.b : p.a;
        const n = layout.ops.get(op);
        if (!n) continue;
        const [x0, y0] = polar(0, 0, R, n.angle);
        const [qx, qy] = polar(0, 0, R * 0.5, n.angle + 0.02);
        const [x1, y1] = polar(0, 0, hubR + 2, n.angle + 0.08);
        ctx.moveTo(x0, y0);
        ctx.quadraticCurveTo(qx, qy, x1, y1);
      } else {
        const na = layout.ops.get(p.a)?.node;
        const nb = layout.ops.get(p.b)?.node;
        if (!na || !nb) continue;
        line(na.path(nb) as HierarchyPointNode<unknown>[]);
      }
      ctx.strokeStyle = `rgba(91,107,125,${alpha})`;
      ctx.lineWidth = w;
      ctx.stroke();
    }
  }, [layout, pairs, width, height, cx, cy, R, hubR, dim, maxMass]);
  return <canvas ref={ref} className="pointer-events-none absolute inset-0" style={{ width, height }} aria-hidden data-testid="bg-canvas" />;
}
