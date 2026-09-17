"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { CountUp, Reveal, ScrollColorText } from "@/components/motion";

/*
 * The week, measured: 168 hours a token trades, 32.5 of them with a share price behind it. Every figure here is
 * arithmetic on the numbers in CLAUDE.md 6 (32.5 regular hours, a 75 hour weekend, 168 in the week). The thin strip
 * under it is CoinGecko's perps against spot, September 2026.
 */
const SEGS = [
  { key: "regular", label: "Regular", long: "Regular session, 09:30 to 16:00 New York", hours: 32.5, fill: "fill-wallets" },
  { key: "off", label: "Off-hours", long: "Weekday pre, post and overnight", hours: 60.5, fill: "fill-other" },
  { key: "weekend", label: "Weekend", long: "Friday close to Monday open", hours: 75, fill: "fill-lamports" }
];
const WEEK = 168;
const PERPS = 376.3;
const SPOT = 7.5;

function pct(h: number): string {
  return ((h / WEEK) * 100).toFixed(1);
}

export function HoursStrip() {
  const reduce = useReducedMotion();
  const [tip, setTip] = useState<string | null>(null);
  const perpShare = ((PERPS / (PERPS + SPOT)) * 100).toFixed(1);
  return (
    <section className="asec" style={{ borderBottom: "1px solid var(--line)" }}>
      <div className="acontainer" style={{ padding: "80px 30px" }}>
        <span className="tick tl" aria-hidden /><span className="tick tr" aria-hidden />
        <div className="two" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 64, alignItems: "start" }}>
          <div>
            <ScrollColorText as="h2" text="About one hour in five has a share price behind it." className="h-section" />
            <Reveal y={18} delay={0.1}><p className="body" style={{ marginTop: 18, maxWidth: 520 }}>The rest of the week the token is the only price in the world for Nvidia. A perp defends a mark through those hours with your margin. A contract with a fixed strike has nothing to defend.</p></Reveal>
          </div>
          <Reveal y={48} delay={0.1}>
            <div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 18, flexWrap: "wrap" }}>
                <CountUp value={`${pct(32.5)}%`} className="mono" style={{ fontSize: 72, lineHeight: "72px", letterSpacing: "-0.03em", color: "var(--ink)" }} />
                <span className="body" style={{ maxWidth: 320 }}>of the week the shares behind NVDAx are trading</span>
              </div>
              <div className="strip" style={{ marginTop: 28 }} role="img" aria-label={`The week by session: ${SEGS.map((s) => `${s.label} ${pct(s.hours)}%`).join(", ")}`}>
                {SEGS.map((s, i) => (
                  <motion.div key={s.key} className={`seg ${s.fill}`} style={{ width: `${(s.hours / WEEK) * 100}%`, transformOrigin: "left" }} initial={reduce ? false : { scaleX: 0 }} whileInView={{ scaleX: 1 }} viewport={{ once: true, amount: 0.6 }} transition={{ duration: 0.9, ease: [0.2, 0, 0, 1], delay: 0.05 * i }} tabIndex={0} role="note" aria-label={`${s.label}: ${s.hours} hours, ${pct(s.hours)}% of the week`} onMouseEnter={() => setTip(s.key)} onMouseLeave={() => setTip(null)} onFocus={() => setTip(s.key)} onBlur={() => setTip(null)}>
                    {tip === s.key ? <span className="tip" style={{ transform: "translateX(-50%)" }}>{s.long} · {s.hours} h · {pct(s.hours)}%</span> : null}
                  </motion.div>
                ))}
              </div>
              <div className="strip-labels" aria-hidden>
                {SEGS.map((s) => <span key={s.key} style={{ width: `${(s.hours / WEEK) * 100}%` }}>{s.label} {pct(s.hours)}%</span>)}
              </div>
              <div className="legend">
                {SEGS.map((s) => <span key={s.key}><i className={s.fill} />{s.long}, {s.hours} h</span>)}
              </div>
              <p className="note" style={{ marginTop: 18 }}>168 hours a week for the token, 32.5 for the share (five sessions of 6.5 hours), 75 between Friday&apos;s close and Monday&apos;s open. NYSE holidays lower the 32.5 further.</p>
              <div style={{ marginTop: 22 }}>
                <div className="strip" style={{ height: 8 }} role="img" aria-label={`Perpetuals were ${perpShare}% of tokenized-equity volume`}>
                  <motion.div className="seg fill-other" style={{ width: `${perpShare}%`, transformOrigin: "left" }} initial={reduce ? false : { scaleX: 0 }} whileInView={{ scaleX: 1 }} viewport={{ once: true, amount: 0.6 }} transition={{ duration: 0.9, ease: [0.2, 0, 0, 1], delay: 0.3 }} />
                  <div className="seg fill-wallets" style={{ flex: 1 }} />
                </div>
                <p className="note" style={{ marginTop: 8 }}><span className="mono" style={{ color: "var(--ink-2)" }}>${PERPS}B</span> of perpetuals against <span className="mono" style={{ color: "var(--ink-2)" }}>${SPOT}B</span> of spot on tokenized equities (CoinGecko, September 2026). The demand is for leverage.</p>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
      <style>{`@media (max-width: 809px) { .two { grid-template-columns: minmax(0, 1fr) !important; gap: 32px !important; } }`}</style>
    </section>
  );
}
