"use client";

import { useMemo } from "react";
import { breakEven, buyerPnl, type Side } from "@/lib/model";
import { usd, usdSmart } from "@/lib/format";

/*
 * The payoff picture: profit or loss at expiry against the price, for a buyer. Plain SVG in the chart's own style
 * (hairlines, one green line, a gradient under it), the max loss pinned as a flat floor, break-even and the expected
 * price marked. The slider that drives `expected` lives in the parent so the numbers beside it update in step.
 */
export function PayoffChart({ side, strike, premium, shares, mark, expected, height = 240 }: { side: Side; strike: number; premium: number; shares: number; mark: number; expected: number; height?: number }) {
  const W = 800;
  const H = height;
  const padX = 8;
  const padY = 18;
  const model = useMemo(() => {
    const lo = Math.min(mark, strike) * 0.8;
    const hi = Math.max(mark, strike) * 1.2;
    const xs: number[] = [];
    for (let i = 0; i <= 80; i++) xs.push(lo + ((hi - lo) * i) / 80);
    const ys = xs.map((s) => buyerPnl(side, strike, premium, shares, s));
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const span = maxY - minY || 1;
    const sx = (s: number) => padX + ((s - lo) / (hi - lo)) * (W - padX * 2);
    const sy = (v: number) => padY + (1 - (v - minY) / span) * (H - padY * 2);
    const pts = xs.map((s, i) => [sx(s), sy(ys[i] as number)] as const);
    const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    const zero = sy(0);
    const area = `${d} L${(pts[pts.length - 1] as readonly [number, number])[0].toFixed(1)},${zero.toFixed(1)} L${(pts[0] as readonly [number, number])[0].toFixed(1)},${zero.toFixed(1)} Z`;
    const be = breakEven(side, strike, premium);
    return { lo, hi, sx, sy, d, area, zero, be, minY, maxY };
  }, [side, strike, premium, shares, mark, H]);

  const ex = Math.min(model.hi, Math.max(model.lo, expected));
  const exPnl = buyerPnl(side, strike, premium, shares, ex);
  const exX = model.sx(ex);
  const exY = model.sy(exPnl);
  const floor = model.sy(-premium * shares);

  return (
    <div className="chart" style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Payoff at expiry for ${shares} shares: max loss ${usd(premium * shares)}, break-even ${usd(model.be)}`} style={{ width: "100%", height: H, display: "block" }}>
        <defs>
          <linearGradient id="pfill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--green)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--green)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1={padX} x2={W - padX} y1={model.zero} y2={model.zero} stroke="var(--line-strong)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        <line x1={padX} x2={W - padX} y1={floor} y2={floor} stroke="var(--amber)" strokeWidth="1" strokeDasharray="3 5" vectorEffect="non-scaling-stroke" />
        <path d={model.area} fill="url(#pfill)" />
        <path d={model.d} fill="none" stroke="var(--green)" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
        <line x1={model.sx(model.be)} x2={model.sx(model.be)} y1={padY} y2={H - padY} stroke="var(--line-strong)" strokeWidth="1" strokeDasharray="2 4" vectorEffect="non-scaling-stroke" />
        <line x1={model.sx(mark)} x2={model.sx(mark)} y1={padY} y2={H - padY} stroke="var(--line)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        <line x1={exX} x2={exX} y1={padY} y2={H - padY} stroke="var(--ink)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        <circle cx={exX} cy={exY} r="3.5" fill={exPnl >= 0 ? "var(--green)" : "var(--amber)"} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="absolute small num" style={{ left: `${(model.sx(model.be) / W) * 100}%`, top: 2, transform: "translateX(-50%)", whiteSpace: "nowrap" }}>break-even ${usd(model.be)}</div>
      <div className="absolute small num" style={{ left: `${(model.sx(mark) / W) * 100}%`, bottom: 2, transform: "translateX(-50%)", whiteSpace: "nowrap", color: "var(--slate)" }}>mark ${usd(mark)}</div>
      <div className="absolute small num" style={{ right: 8, top: `${(floor / H) * 100}%`, transform: "translateY(-100%)", color: "var(--amber)" }}>max loss −${usdSmart(premium * shares)}</div>
      <div className="tip" style={{ left: `${(exX / W) * 100}%`, top: `${(exY / H) * 100}%`, marginTop: -10 }}>
        <div className={`num ${exPnl >= 0 ? "up" : "down"}`}>{exPnl >= 0 ? "+" : "−"}${usdSmart(Math.abs(exPnl))}</div>
        <div className="muted">at ${usd(ex)}</div>
      </div>
    </div>
  );
}
