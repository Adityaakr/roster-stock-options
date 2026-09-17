"use client";

import { motion, useReducedMotion } from "motion/react";
import { Reveal, ScrollColorText } from "@/components/motion";
import { Sec } from "./sec";

/*
 * How it is different: the comparison table from CLAUDE.md 6, then the 2x2 drawn from it. Across: open on Saturday.
 * Up: the worst case is known before you click. Perps and loops are open but unbounded; listed options are bounded
 * but closed; Roster sits in the shaded corner.
 */
const DOTS = [
  { id: "perps", x: 0.82, y: 0.18, name: "Perps", sub: "Hyperliquid, CEX stock perps, Wasabi", side: "left" as const },
  { id: "loops", x: 0.6, y: 0.3, name: "Loops", sub: "Kamino, Loopscale", side: "left" as const },
  { id: "cboe", x: 0.16, y: 0.86, name: "Listed options", sub: "CBOE, closed Saturday", side: "right" as const },
  { id: "roster", x: 0.84, y: 0.82, name: "Roster Finance", sub: "known loss, open Saturday, settles in the token", side: "left" as const }
];

export function Quadrant() {
  const reduce = useReducedMotion();
  const W = 720;
  const H = 470;
  const pad = { l: 150, r: 28, t: 44, b: 70 };
  const px = (x: number) => pad.l + x * (W - pad.l - pad.r);
  const py = (y: number) => H - pad.b - y * (H - pad.t - pad.b);
  const us = DOTS[3]!;
  const midX = px(0.5);
  const midY = py(0.5);
  const enter = (i: number) => (reduce ? {} : { initial: { opacity: 0, scale: 0.6 }, whileInView: { opacity: 1, scale: 1 }, viewport: { once: true, amount: 0.5 }, transition: { duration: 0.22, ease: [0.2, 0, 0, 1] as const, delay: 0.1 + i * 0.16 } });
  const label = (d: (typeof DOTS)[number]) => {
    const dir = d.side === "left" ? -1 : 1;
    return { x: px(d.x) + dir * 16, anchor: d.side === "left" ? ("end" as const) : ("start" as const) };
  };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby="quad-title quad-desc" style={{ width: "100%", height: "auto", display: "block" }}>
      <title id="quad-title">Known worst case against weekend access</title>
      <desc id="quad-desc">Perps and loops are open on Saturday but can liquidate you. Listed options cap the loss at the premium but are closed on Saturday. Roster Finance sits in the top right: loss capped at the premium, open on Saturday.</desc>
      <rect x={midX} y={pad.t} width={W - pad.r - midX} height={midY - pad.t} fill="var(--surface)" />
      <rect x={pad.l} y={pad.t} width={W - pad.l - pad.r} height={H - pad.t - pad.b} fill="none" stroke="var(--line)" strokeWidth="1" />
      <line x1={midX} x2={midX} y1={pad.t} y2={H - pad.b} stroke="var(--line)" strokeWidth="1" strokeDasharray="2 4" />
      <line x1={pad.l} x2={W - pad.r} y1={midY} y2={midY} stroke="var(--line)" strokeWidth="1" strokeDasharray="2 4" />
      <text className="quad-cap" x={midX + 14} y={pad.t + 20}>Known loss, open Saturday</text>
      <text className="quad-cap" x={pad.l + 14} y={midY - 12}>Known loss, closed Saturday</text>
      <text className="quad-cap" x={midX + 14} y={H - pad.b - 12}>Open Saturday, can liquidate you</text>
      <text className="axis" x={pad.l} y={H - pad.b + 24}>EXCHANGE HOURS ONLY</text>
      <text className="axis" x={W - pad.r} y={H - pad.b + 24} textAnchor="end">168 HOURS A WEEK</text>
      <text className="axis" x={(pad.l + W - pad.r) / 2} y={H - 14} textAnchor="middle">OPEN ON SATURDAY →</text>
      <text className="axis" x={pad.l - 14} y={pad.t + 14} textAnchor="end">MAX LOSS IS</text>
      <text className="axis" x={pad.l - 14} y={pad.t + 28} textAnchor="end">THE PREMIUM</text>
      <text className="axis" x={pad.l - 14} y={H - pad.b - 4} textAnchor="end">LIQUIDATION</text>
      <text className="axis" transform={`translate(${pad.l - 14} ${(pad.t + py(0)) / 2}) rotate(-90)`} textAnchor="middle">WORST CASE KNOWN ↑</text>
      {DOTS.slice(0, 3).map((d, i) => (
        <motion.line key={`gap-${d.id}`} x1={px(d.x)} y1={py(d.y)} x2={px(us.x)} y2={py(us.y)} stroke="var(--line-strong)" strokeWidth="1" strokeDasharray="3 5" {...(reduce ? {} : { initial: { opacity: 0 }, whileInView: { opacity: 1 }, viewport: { once: true, amount: 0.5 }, transition: { duration: 0.4, delay: 0.7 + i * 0.1 } })} />
      ))}
      {DOTS.map((d, i) => {
        const l = label(d);
        const me = d.id === "roster";
        return (
          <motion.g key={d.id} tabIndex={0} role="img" aria-label={`${d.name}: ${d.sub}`} style={{ outline: "none", transformOrigin: `${px(d.x)}px ${py(d.y)}px` }} {...enter(i)}>
            {me ? <circle cx={px(d.x)} cy={py(d.y)} r="12" fill="none" stroke="var(--ink)" strokeOpacity="0.18" strokeWidth="1" /> : null}
            <circle cx={px(d.x)} cy={py(d.y)} r={me ? 6 : 5} fill={me ? "var(--ink)" : "var(--paper)"} stroke="var(--ink)" strokeWidth="1.2" />
            <text className="dotlabel" x={l.x} y={py(d.y) - 4} textAnchor={l.anchor} fontWeight={me ? 600 : 500}>{d.name}</text>
            <text className="dotsub" x={l.x} y={py(d.y) + 14} textAnchor={l.anchor}>{d.sub}</text>
          </motion.g>
        );
      })}
    </svg>
  );
}

const ROWS: [string, string, string, string, string][] = [
  ["Max loss", "Unbounded, liquidation", "Collateral liquidation", "Premium", "Premium"],
  ["Funding or interest", "Yes", "Yes", "No", "No"],
  ["Open on Saturday", "Yes, synthetic mark", "Yes", "No", "Yes"],
  ["Settles into your wallet", "No", "No", "No", "Yes, the token itself"],
  ["Can liquidate you", "Yes", "Yes", "No", "No"]
];
const HEADS: [string, string][] = [["Perps", "Hyperliquid, CEX stock perps, Wasabi"], ["Loops", "Kamino, Loopscale"], ["Listed options", "CBOE"], ["Roster Finance", "fully collateralized, on Solana"]];

/** The four-column comparison; the Roster column is white on the surface with an ink rule. Stacks at phone width with Roster first. */
export function FourColumns() {
  return (
    <div>
      <div className="fc-table scroll-x">
        <table className="fctable">
          <thead>
            <tr>
              <th />
              {HEADS.map(([h, sub], i) => <th key={h} className={i === 3 ? "us" : ""} style={{ width: "21%" }}>{h}<div className="small" style={{ fontFamily: "var(--sans)", fontWeight: 400, marginTop: 2 }}>{sub}</div></th>)}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r[0]}>
                <th scope="row">{r[0]}</th>
                {r.slice(1).map((c, i) => <td key={i} className={i === 3 ? "us" : ""}>{c}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="fc-stack">
        {[3, 0, 1, 2].map((ci) => (
          <div key={ci} className={`fcblock ${ci === 3 ? "us" : ""}`}>
            <div className="h-item">{HEADS[ci]?.[0]}</div>
            <div className="small" style={{ margin: "2px 0 8px" }}>{HEADS[ci]?.[1]}</div>
            {ROWS.map((r) => (
              <div key={r[0]} className="fcline"><span className="k">{r[0]}</span><span>{r[ci + 1]}</span></div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function Difference() {
  return (
    <Sec id="different" className="automation" ticks={false}>
      <div style={{ padding: "80px 0", display: "flex", flexDirection: "column", gap: 50 }}>
        <div style={{ padding: "0 30px", display: "flex", flexDirection: "column", gap: 20 }}>
          <ScrollColorText as="h2" text="Perps take the position. Roster caps the loss." className="h-section" style={{ maxWidth: 896 }} />
          <Reveal y={0} delay={0.2}><p className="body" style={{ margin: 0, maxWidth: 796 }}>Perps take your position on the wick. Roster caps your loss at the premium and delivers the stock. Today on Solana the only ways to lever a stock are a perp or a loan loop, and both liquidate; listed options cap the loss but close on Friday. Roster is the fourth column.</p></Reveal>
        </div>
        <Reveal y={48}><div style={{ padding: "0 30px" }}><FourColumns /></div></Reveal>
        <div className="two" style={{ display: "grid", gridTemplateColumns: "392px minmax(0, 1fr)", gap: 64, alignItems: "center", padding: "0 45px 0 30px" }}>
          <div>
            <div className="h-item" style={{ fontSize: 22, letterSpacing: "-0.03em" }}>The empty corner</div>
            <p className="body" style={{ margin: "12px 0 0" }}>Open on Saturday across, worst case known up. Every incumbent sits in a corner that gives one up. The shaded quadrant is where a bounded loss and a weekend book meet. That is the fourth column, drawn.</p>
          </div>
          <Reveal y={48} delay={0.1}><div className="aimage"><div style={{ padding: 8 }}><Quadrant /></div></div></Reveal>
        </div>
      </div>
      <style>{`@media (max-width: 809px) { .automation .two { grid-template-columns: minmax(0, 1fr) !important; gap: 24px !important; padding: 0 18px !important; } }`}</style>
    </Sec>
  );
}
