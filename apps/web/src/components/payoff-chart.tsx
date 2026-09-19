"use client";

import { useMemo } from "react";
import { breakEven, buyerPnl, type Side } from "@/lib/model";
import { usd, usdSmart } from "@/lib/format";

/*
 * The payoff picture: profit or loss at expiry against the price, for a buyer. Plain SVG in the chart's own style
 * (hairlines, one green line, a gradient under it), the max loss pinned as a flat floor, break-even and the expected
 * price marked. The slider that drives `expected` lives in the parent so the numbers beside it update in step.
 *
 * Every label is drawn inside the plot with a paper chip behind it and clamped to the box, so nothing overlaps the
 * line, the dashed floor or the card's edge at any width.
 */
export function PayoffChart({ side, strike, premium, shares, mark, expected, height = 260 }: { side: Side; strike: number; premium: number; shares: number; mark: number; expected: number; height?: number }) {
  const W = 800;
  const H = height;
  const pad = { l: 14, r: 14, t: 34, b: 30 };
  const model = useMemo(() => {
    const lo = Math.min(mark, strike) * 0.8;
    const hi = Math.max(mark, strike) * 1.2;
    const xs: number[] = [];
    for (let i = 0; i <= 80; i++) xs.push(lo + ((hi - lo) * i) / 80);
    const ys = xs.map((s) => buyerPnl(side, strike, premium, shares, s));
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const span = maxY - minY || 1;
    const sx = (s: number) => pad.l + ((s - lo) / (hi - lo)) * (W - pad.l - pad.r);
    const sy = (v: number) => pad.t + (1 - (v - minY) / span) * (H - pad.t - pad.b);
    const pts = xs.map((s, i) => [sx(s), sy(ys[i] as number)] as const);
    const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    const zero = sy(0);
    const area = `${d} L${(pts[pts.length - 1] as readonly [number, number])[0].toFixed(1)},${zero.toFixed(1)} L${(pts[0] as readonly [number, number])[0].toFixed(1)},${zero.toFixed(1)} Z`;
    return { lo, hi, sx, sy, d, area, zero, be: breakEven(side, strike, premium) };
  }, [side, strike, premium, shares, mark, H, pad.l, pad.r, pad.t, pad.b]);

  const ex = Math.min(model.hi, Math.max(model.lo, expected));
  const exPnl = buyerPnl(side, strike, premium, shares, ex);
  const exX = model.sx(ex);
  const exY = model.sy(exPnl);
  const floor = model.sy(-premium * shares);
  const pct = (v: number, total: number) => `${(v / total) * 100}%`;
  // The readout follows the point but never leaves the plot: it flips side past the middle and sits below a high point.
  const tipLeft = Math.min(W - pad.r - 4, Math.max(pad.l + 4, exX));
  const tipAbove = exY > pad.t + 56;
  const tipAnchor = exX > W * 0.62 ? "end" : exX < W * 0.38 ? "start" : "center";

  return (
    <div className="pchart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Payoff at expiry for ${shares} shares: max loss ${usd(premium * shares)}, break-even ${usd(model.be)}`} style={{ width: "100%", height: H, display: "block" }}>
        <defs>
          <linearGradient id="pfill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--green)" stopOpacity="0.2" />
            <stop offset="100%" stopColor="var(--green)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1={pad.l} x2={W - pad.r} y1={model.zero} y2={model.zero} stroke="var(--line-strong)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        <line x1={pad.l} x2={W - pad.r} y1={floor} y2={floor} stroke="var(--amber)" strokeWidth="1" strokeDasharray="3 5" vectorEffect="non-scaling-stroke" />
        <path d={model.area} fill="url(#pfill)" />
        <path d={model.d} fill="none" stroke="var(--green)" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
        <line x1={model.sx(model.be)} x2={model.sx(model.be)} y1={pad.t} y2={H - pad.b} stroke="var(--line-strong)" strokeWidth="1" strokeDasharray="2 4" vectorEffect="non-scaling-stroke" />
        <line x1={model.sx(mark)} x2={model.sx(mark)} y1={pad.t} y2={H - pad.b} stroke="var(--line)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        <line x1={exX} x2={exX} y1={pad.t} y2={H - pad.b} stroke="var(--ink)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        <circle cx={exX} cy={exY} r="3.5" fill={exPnl >= 0 ? "var(--green)" : "var(--amber)"} vectorEffect="non-scaling-stroke" />
      </svg>

      {/* Labels ride above the plot in HTML so they keep the site's type at any width. */}
      <span className="pchart-tag top" style={{ left: pct(model.sx(model.be), W), transform: labelShift(model.sx(model.be), W) }}>break-even <b className="num">${usd(model.be)}</b></span>
      <span className="pchart-tag bottom" style={{ left: pct(model.sx(mark), W), transform: labelShift(model.sx(mark), W) }}>mark <b className="num">${usd(mark)}</b></span>
      <span className="pchart-tag floor" style={{ top: pct(floor, H) }}>max loss <b className="num">−${usdSmart(premium * shares)}</b></span>
      <span className={`pchart-tip ${tipAbove ? "above" : "below"} ${tipAnchor}`} style={{ left: pct(tipLeft, W), top: pct(exY, H) }}>
        <b className={`num ${exPnl >= 0 ? "up" : "down"}`}>{exPnl >= 0 ? "+" : "−"}${usdSmart(Math.abs(exPnl))}</b>
        <span className="muted num">at ${usd(ex)}</span>
      </span>
    </div>
  );
}

/** Keep a label inside the plot: centred in the middle, tucked in at either edge. */
function labelShift(x: number, W: number): string {
  if (x < W * 0.14) return "translateX(0)";
  if (x > W * 0.86) return "translateX(-100%)";
  return "translateX(-50%)";
}
