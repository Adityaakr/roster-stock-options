"use client";

import { motion, useReducedMotion } from "motion/react";

/*
 * Payoff sketches for the product cards, in the page's own hairline SVG style (as the Quadrant and the chart): a
 * plot frame, a zero line, one ink payoff line drawn on view, a shaded region for what is bounded, and the axis
 * labels in mono. Each shape is the payoff at expiry for that product, nothing decorative.
 */
type Kind = "gap" | "floor" | "commit" | "protected" | "firstprint";

const W = 640;
const H = 263;
const pad = { l: 56, r: 24, t: 26, b: 40 };
const x = (v: number) => pad.l + v * (W - pad.l - pad.r);
const y = (v: number) => pad.t + (1 - v) * (H - pad.t - pad.b);

const SHAPES: Record<Kind, { line: string; fill?: string; strike?: number; floor?: number; labels: [string, string]; caption: string }> = {
  gap: { line: `M${x(0)} ${y(0.3)} L${x(0.5)} ${y(0.3)} L${x(1)} ${y(0.95)}`, fill: `M${x(0)} ${y(0.3)} L${x(0.5)} ${y(0.3)} L${x(0.5)} ${y(0.42)} L${x(0)} ${y(0.42)} Z`, strike: 0.5, floor: 0.3, labels: ["PRICE AT EXPIRY →", "PROFIT ↑"], caption: "loss capped at the premium, upside open" },
  floor: { line: `M${x(0)} ${y(0.95)} L${x(0.5)} ${y(0.3)} L${x(1)} ${y(0.3)}`, fill: `M${x(0.5)} ${y(0.3)} L${x(1)} ${y(0.3)} L${x(1)} ${y(0.42)} L${x(0.5)} ${y(0.42)} Z`, strike: 0.5, floor: 0.3, labels: ["PRICE AT EXPIRY →", "PROFIT ↑"], caption: "a funded exit at the strike, any time until expiry" },
  commit: { line: `M${x(0)} ${y(0.05)} L${x(0.5)} ${y(0.55)} L${x(1)} ${y(0.55)}`, fill: `M${x(0.5)} ${y(0.42)} L${x(1)} ${y(0.42)} L${x(1)} ${y(0.55)} L${x(0.5)} ${y(0.55)} Z`, strike: 0.5, labels: ["PRICE AT EXPIRY →", "PROFIT ↑"], caption: "premium kept above the strike, assigned below it" },
  protected: { line: `M${x(0)} ${y(0.36)} L${x(0.4)} ${y(0.36)} L${x(1)} ${y(0.95)}`, fill: `M${x(0)} ${y(0.36)} L${x(0.4)} ${y(0.36)} L${x(0.4)} ${y(0.42)} L${x(0)} ${y(0.42)} Z`, strike: 0.4, floor: 0.36, labels: ["PRICE AT EXPIRY →", "VALUE ↑"], caption: "the token, with a floor under it through a date" },
  firstprint: { line: `M${x(0)} ${y(0.2)} L${x(0.3)} ${y(0.25)} L${x(0.55)} ${y(0.15)} L${x(0.7)} ${y(0.3)} L${x(0.7)} ${y(0.72)} L${x(1)} ${y(0.72)}`, fill: `M${x(0.7)} ${y(0.72)} L${x(1)} ${y(0.72)} L${x(1)} ${y(0.42)} L${x(0.7)} ${y(0.42)} Z`, strike: 0.7, labels: ["TIME →", "KNOWN PRICE ↑"], caption: "a known price on a known date, for an asset with no exit" }
};

export function Sketch({ kind }: { kind: Kind }) {
  const s = SHAPES[kind];
  const reduce = useReducedMotion();
  const draw = reduce ? {} : { initial: { pathLength: 0 }, whileInView: { pathLength: 1 }, viewport: { once: true, amount: 0.5 }, transition: { duration: 0.9, ease: [0.2, 0, 0, 1] as const, delay: 0.2 } };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${kind}: ${s.caption}`} style={{ width: "100%", height: "auto", display: "block" }}>
      <rect x={pad.l} y={pad.t} width={W - pad.l - pad.r} height={H - pad.t - pad.b} fill="none" stroke="var(--line)" strokeWidth="1" />
      {s.fill ? <path d={s.fill} fill="var(--surface)" /> : null}
      <line x1={pad.l} x2={W - pad.r} y1={y(0.42)} y2={y(0.42)} stroke="var(--line-strong)" strokeWidth="1" />
      {s.strike !== undefined ? <line x1={x(s.strike)} x2={x(s.strike)} y1={pad.t} y2={H - pad.b} stroke="var(--line)" strokeWidth="1" strokeDasharray="2 4" /> : null}
      <motion.path d={s.line} fill="none" stroke="var(--ink)" strokeWidth="1.6" strokeLinejoin="round" {...draw} />
      {s.floor !== undefined ? <line x1={pad.l} x2={W - pad.r} y1={y(s.floor)} y2={y(s.floor)} stroke="var(--amber)" strokeWidth="1" strokeDasharray="3 5" /> : null}
      <text className="axis" x={pad.l} y={H - 12}>{s.labels[0]}</text>
      <text className="axis" transform={`translate(${pad.l - 14} ${(pad.t + H - pad.b) / 2}) rotate(-90)`} textAnchor="middle">{s.labels[1]}</text>
      {s.strike !== undefined ? <text className="axis" x={x(s.strike)} y={pad.t - 8} textAnchor="middle">{kind === "firstprint" ? "KNOWN DATE" : "STRIKE"}</text> : null}
      {s.floor !== undefined ? <text className="axis" x={kind === "floor" ? W - pad.r : pad.l + 6} y={y(s.floor) - 6} textAnchor={kind === "floor" ? "end" : "start"} fill="var(--amber)">{kind === "protected" ? "FLOOR" : "MAX LOSS"}</text> : null}
      <text className="quad-cap" x={W - pad.r} y={H - 12} textAnchor="end">{s.caption}</text>
    </svg>
  );
}
