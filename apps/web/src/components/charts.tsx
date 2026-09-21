"use client";

import { useMemo, useRef, useState } from "react";

/*
 * Two SVG charts in the site's own type and lines: a sparkline for lists and a line chart with a hover readout for
 * detail pages. Points are [unix seconds, value]. No library, no gradients that are not the paper's own.
 */
export type Point = [number, number];

export function Sparkline({ points, width = 96, height = 28 }: { points: Point[]; width?: number; height?: number }) {
  if (points.length < 2) return <svg width={width} height={height} aria-hidden><line x1={0} x2={width} y1={height / 2} y2={height / 2} stroke="var(--line-strong)" strokeDasharray="2 3" /></svg>;
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  const sx = (x: number) => (x1 === x0 ? 0 : ((x - x0) / (x1 - x0)) * (width - 2) + 1);
  const sy = (y: number) => (y1 === y0 ? height / 2 : height - 2 - ((y - y0) / (y1 - y0)) * (height - 4));
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${sx(p[0]).toFixed(1)} ${sy(p[1]).toFixed(1)}`).join(" ");
  const up = ys[ys.length - 1]! >= ys[0]!;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden style={{ display: "block" }}>
      <path d={d} fill="none" stroke={up ? "var(--green)" : "var(--amber)"} strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export interface Series { label: string; points: Point[]; color?: string; dashed?: boolean }

export function LineChart({ series, height = 260, format = (v: number) => v.toFixed(2), timeFormat, empty = "No history recorded yet on this cluster." }: { series: Series[]; height?: number; format?: (v: number) => string; timeFormat?: (t: number) => string; empty?: string }) {
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const W = 800;
  const H = height;
  const pad = { l: 8, r: 64, t: 16, b: 28 };
  const all = series.flatMap((s) => s.points);
  const dims = useMemo(() => {
    if (all.length < 2) return null;
    const xs = all.map((p) => p[0]);
    const ys = all.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    let y0 = Math.min(...ys), y1 = Math.max(...ys);
    const padY = (y1 - y0) * 0.08 || Math.abs(y0) * 0.01 || 1;
    y0 -= padY; y1 += padY;
    return { x0, x1, y0, y1 };
  }, [all]);
  if (!dims) return <div className="chart-empty">{empty}</div>;
  const { x0, x1, y0, y1 } = dims;
  const sx = (x: number) => pad.l + ((x - x0) / Math.max(1, x1 - x0)) * (W - pad.l - pad.r);
  const sy = (y: number) => pad.t + (1 - (y - y0) / (y1 - y0)) * (H - pad.t - pad.b);
  const ticksY = [0, 0.25, 0.5, 0.75, 1].map((f) => y0 + f * (y1 - y0));
  const tf = timeFormat ?? ((t: number) => new Date(t * 1000).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }));
  // Three time ticks across the span, one when the span is too short for them to read apart.
  const ticksX = x1 - x0 < 3_600 ? [x0 + (x1 - x0) / 2] : [0, 0.5, 1].map((f) => x0 + f * (x1 - x0));
  const hoverT = hover === null ? null : x0 + hover * (x1 - x0);
  const nearest = (s: Series) => {
    if (hoverT === null || !s.points.length) return null;
    let best = s.points[0]!;
    for (const p of s.points) if (Math.abs(p[0] - hoverT) < Math.abs(best[0] - hoverT)) best = p;
    return best;
  };
  return (
    <div className="chart">
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label={series.map((s) => s.label).join(", ")}
        onMouseMove={(e) => { const r = ref.current!.getBoundingClientRect(); const x = ((e.clientX - r.left) / r.width) * W; setHover(Math.min(1, Math.max(0, (x - pad.l) / (W - pad.l - pad.r)))); }}
        onMouseLeave={() => setHover(null)}>
        {ticksY.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={sy(t)} y2={sy(t)} stroke="var(--line)" />
            <text x={W - pad.r + 8} y={sy(t) + 4} className="chart-tick">{format(t)}</text>
          </g>
        ))}
        {ticksX.map((t, i) => <text key={t} x={sx(t)} y={H - 8} className="chart-tick" textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"}>{tf(t)}</text>)}
        {series.map((s) => (
          <path key={s.label} d={s.points.map((p, i) => `${i === 0 ? "M" : "L"}${sx(p[0]).toFixed(1)} ${sy(p[1]).toFixed(1)}`).join(" ")} fill="none" stroke={s.color ?? "var(--ink)"} strokeWidth="1.5" strokeDasharray={s.dashed ? "4 4" : undefined} strokeLinejoin="round" />
        ))}
        {hoverT !== null ? <line x1={sx(hoverT)} x2={sx(hoverT)} y1={pad.t} y2={H - pad.b} stroke="var(--line-strong)" strokeDasharray="2 3" /> : null}
        {hoverT !== null ? series.map((s) => { const p = nearest(s); return p ? <circle key={s.label} cx={sx(p[0])} cy={sy(p[1])} r="3.5" fill={s.color ?? "var(--ink)"} stroke="var(--paper)" strokeWidth="1.5" /> : null; }) : null}
      </svg>
      <div className="chart-legend">
        {series.map((s) => { const p = hoverT !== null ? nearest(s) : s.points[s.points.length - 1]; return (
          <span key={s.label}><i style={{ background: s.color ?? "var(--ink)", borderStyle: s.dashed ? "dashed" : "solid" }} />{s.label} <b className="mono">{p ? format(p[1]) : "–"}</b>{p && hoverT !== null ? <span className="muted"> · {tf(p[0])}</span> : null}</span>
        ); })}
      </div>
    </div>
  );
}

/** Horizontal bars for a small categorical set: depth per expiry, capital per underwriter. */
export function Bars({ rows, format = (v: number) => v.toLocaleString("en-US") }: { rows: { label: string; value: number; sub?: string }[]; format?: (v: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="bars">
      {rows.map((r) => (
        <div key={r.label} className="bar-row">
          <div className="bar-label">{r.label}{r.sub ? <span className="muted"> · {r.sub}</span> : null}</div>
          <div className="bar-track"><span style={{ width: `${(r.value / max) * 100}%` }} /></div>
          <div className="bar-value mono">{format(r.value)}</div>
        </div>
      ))}
    </div>
  );
}
