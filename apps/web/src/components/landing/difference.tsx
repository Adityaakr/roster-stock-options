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
  { id: "perps", x: 0.86, y: 0.16, name: "Perps", sub: "Hyperliquid, CEX perps, Wasabi", verdict: ["Open Saturday,", "can liquidate you"] },
  { id: "loops", x: 0.62, y: 0.3, name: "Loops", sub: "Kamino, Loopscale", verdict: ["Open Saturday,", "collateral liquidation"] },
  { id: "cboe", x: 0.18, y: 0.84, name: "Listed options", sub: "CBOE", verdict: ["Known loss,", "closed Saturday"] },
  { id: "roster", x: 0.84, y: 0.84, name: "Roster Finance", sub: "fully collateralized, on Solana", verdict: ["Known loss, open Saturday,", "settles in the token"] }
];

/**
 * The 2x2, drawn to a grid: the plot on the left with numbered markers, a legend on the right that names each one.
 * Nothing sits next to a dot, so nothing collides. Across: open on Saturday. Up: the worst case is known before you click.
 */
export function Quadrant() {
  const reduce = useReducedMotion();
  const W = 760;
  const H = 440;
  const plot = { l: 56, r: 270, t: 28, b: 60 };
  const px = (x: number) => plot.l + x * (W - plot.l - plot.r);
  const py = (y: number) => H - plot.b - y * (H - plot.t - plot.b);
  const midX = px(0.5);
  const midY = py(0.5);
  const legendX = W - plot.r + 28;
  const enter = (i: number) => (reduce ? {} : { initial: { opacity: 0, scale: 0.6 }, whileInView: { opacity: 1, scale: 1 }, viewport: { once: true, amount: 0.5 }, transition: { duration: 0.22, ease: [0.2, 0, 0, 1] as const, delay: 0.1 + i * 0.08 } });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby="quad-title quad-desc" style={{ width: "100%", height: "auto", display: "block" }}>
      <title id="quad-title">Known worst case against weekend access</title>
      <desc id="quad-desc">Perps and loops are open on Saturday but can liquidate you. Listed options cap the loss at the premium but are closed on Saturday. Roster Finance sits in the top right: loss capped at the premium, open on Saturday, settled in the token.</desc>
      {/* Plot */}
      <rect x={midX} y={plot.t} width={W - plot.r - midX} height={midY - plot.t} fill="var(--surface)" />
      <rect x={plot.l} y={plot.t} width={W - plot.l - plot.r} height={H - plot.t - plot.b} fill="none" stroke="var(--line-strong)" strokeWidth="1" />
      <line x1={midX} x2={midX} y1={plot.t} y2={H - plot.b} stroke="var(--line)" strokeWidth="1" />
      <line x1={plot.l} x2={W - plot.r} y1={midY} y2={midY} stroke="var(--line)" strokeWidth="1" />
      <text className="quad-cap" x={midX + 10} y={plot.t + 18}>Known loss, open Saturday</text>
      <text className="quad-cap" x={plot.l + 10} y={plot.t + 18}>Known loss, closed Saturday</text>
      <text className="quad-cap" x={midX + 10} y={H - plot.b - 10}>Open Saturday, can liquidate you</text>
      <text className="quad-cap" x={plot.l + 10} y={H - plot.b - 10}>Closed Saturday, can liquidate you</text>
      {/* Axes */}
      <text className="axis" x={plot.l} y={H - plot.b + 22}>EXCHANGE HOURS</text>
      <text className="axis" x={W - plot.r} y={H - plot.b + 22} textAnchor="end">168 HOURS A WEEK</text>
      <text className="axis" x={(plot.l + W - plot.r) / 2} y={H - plot.b + 42} textAnchor="middle">OPEN ON SATURDAY →</text>
      <text className="axis" transform={`translate(${plot.l - 18} ${(plot.t + H - plot.b) / 2}) rotate(-90)`} textAnchor="middle">WORST CASE KNOWN →</text>
      <text className="axis" transform={`translate(${plot.l - 34} ${plot.t + 8}) rotate(-90)`} textAnchor="end">PREMIUM</text>
      <text className="axis" transform={`translate(${plot.l - 34} ${H - plot.b - 8}) rotate(-90)`} textAnchor="start">LIQUIDATION</text>
      {/* Markers */}
      {DOTS.map((d, i) => {
        const me = d.id === "roster";
        return (
          <motion.g key={d.id} style={{ transformOrigin: `${px(d.x)}px ${py(d.y)}px` }} {...enter(i)}>
            {me ? <circle cx={px(d.x)} cy={py(d.y)} r="16" fill="none" stroke="var(--ink)" strokeOpacity="0.14" strokeWidth="1" /> : null}
            <circle cx={px(d.x)} cy={py(d.y)} r="11" fill={me ? "var(--ink)" : "var(--paper)"} stroke="var(--ink)" strokeWidth="1.2" />
            <text x={px(d.x)} y={py(d.y) + 4} textAnchor="middle" fontFamily="var(--mono)" fontSize="11" fill={me ? "var(--paper)" : "var(--ink)"}>{i + 1}</text>
          </motion.g>
        );
      })}
      {/* Legend */}
      <text className="axis" x={legendX} y={plot.t + 12}>WHERE EACH ONE SITS</text>
      {DOTS.map((d, i) => {
        const me = d.id === "roster";
        const y = plot.t + 44 + i * 88;
        return (
          <motion.g key={`legend-${d.id}`} {...enter(i + 4)}>
            <circle cx={legendX + 11} cy={y - 4} r="11" fill={me ? "var(--ink)" : "var(--paper)"} stroke="var(--ink)" strokeWidth="1.2" />
            <text x={legendX + 11} y={y} textAnchor="middle" fontFamily="var(--mono)" fontSize="11" fill={me ? "var(--paper)" : "var(--ink)"}>{i + 1}</text>
            <text className="dotlabel" x={legendX + 32} y={y - 6} fontWeight={me ? 600 : 500}>{d.name}</text>
            <text className="dotsub" x={legendX + 32} y={y + 10}>{d.sub}</text>
            {d.verdict.map((line, k) => <text key={k} className="dotsub" x={legendX + 32} y={y + 26 + k * 14} fill={me ? "var(--ink)" : "var(--slate)"}>{line}</text>)}
            {i < DOTS.length - 1 ? <line x1={legendX} x2={W - 8} y1={y + 54} y2={y + 54} stroke="var(--line)" /> : null}
          </motion.g>
        );
      })}
    </svg>
  );
}

const ROWS: [string, string, string, string, string][] = [
  ["Max loss", "Unbounded, liquidation", "Collateral liquidation", "Premium", "Premium"],
  ["Coverage", "A few dozen synthetic names", "The lending markets' collateral list", "Every listed US name", "COVERAGE"],
  ["Funding or interest", "Yes", "Yes", "No", "No"],
  ["Open on Saturday", "Yes, synthetic mark", "Yes", "No", "Yes"],
  ["Settles into your wallet", "No", "No", "No", "Yes, the token itself"],
  ["Can liquidate you", "Yes", "Yes", "No", "No"]
];
const HEADS: [string, string][] = [["Perps", "Hyperliquid, CEX stock perps, Wasabi"], ["Loops", "Kamino, Loopscale"], ["Listed options", "CBOE"], ["Roster Finance", "fully collateralized, on Solana"]];

/** The four-column comparison; the Roster column is white on the surface with an ink rule. Stacks at phone width with Roster first. */
export function FourColumns({ coverage = "the listed markets, tiered by depth" }: { coverage?: string }) {
  const ROWS_LIVE = ROWS.map((r) => r.map((c) => (c === "COVERAGE" ? coverage : c)) as typeof r);
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
            {ROWS_LIVE.map((r) => (
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
            {ROWS_LIVE.map((r) => (
              <div key={r[0]} className="fcline"><span className="k">{r[0]}</span><span>{r[ci + 1]}</span></div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function Difference({ coverage }: { coverage?: string }) {
  return (
    <Sec id="different" className="automation" ticks={false}>
      <div style={{ padding: "80px 0", display: "flex", flexDirection: "column", gap: 50 }}>
        <div style={{ padding: "0 30px", display: "flex", flexDirection: "column", gap: 20 }}>
          <ScrollColorText as="h2" text="Perps take the position. Roster caps the loss." className="h-section" style={{ maxWidth: 896 }} />
          <Reveal y={0} delay={0.2}><p className="body" style={{ margin: 0, maxWidth: 796 }}>Perps take your position on the wick. Roster caps your loss at the premium and settles in the token itself, into your wallet. Today on Solana the only ways to lever a stock are a perp or a loan loop, and both liquidate; listed options cap the loss but close on Friday. Roster is the fourth column.</p></Reveal>
        </div>
        <Reveal y={48}><div style={{ padding: "0 30px" }}><FourColumns coverage={coverage} /></div></Reveal>
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
