"use client";

import { Reveal, ScrollColorText } from "@/components/motion";
import { usd, usd0, usdSmart } from "@/lib/format";
import type { RosterData } from "@/lib/model";
import { Sec } from "./sec";

/*
 * The problem, told plainly: one weekend, run twice, with a spine of stages between the two columns. On the left a
 * 10x perp on a tokenized stock; on the right a Gap on the same 10 NVDAx. The perp figures are arithmetic on a 10x
 * position (a move of about 10% against it exhausts the margin, before maintenance requirements make it sooner);
 * the Gap figures come from the live quoter.
 */
interface Stage {
  n: string;
  s: string;
  beforeV: string;
  before: string;
  beforeFig: string | null;
  afterV: string;
  after: string;
  afterFig: string | null;
}

export function Weekend({ data }: { data: RosterData }) {
  const near = data.expiries[0] ?? data.nowTs;
  const call = data.terms.find((t) => t.side === "call" && t.strike === 180 && t.expiryTs === near) ?? data.terms.find((t) => t.side === "call") ?? null;
  const mark = data.underlying.mark;
  const shares = 10;
  const notional = mark * shares;
  const margin = notional / 10;
  const prem = call ? call.ask * shares : 0;
  const stages: Stage[] = [
    {
      n: "01", s: "Friday, 16:00 New York",
      beforeV: "The shares stop trading", before: "The exchange closes. The perp keeps a mark from a book that is now the only price in the world for 75 hours.", beforeFig: `10x long, ${shares} ${data.underlying.symbol} notional $${usd0(notional)}, margin $${usd0(margin)}`,
      afterV: "The contract keeps its terms", after: "Strike, expiry and premium are fixed. There is no mark to defend and no margin to top up.", afterFig: call ? `Gap $${usd0(call.strike)} on ${shares} ${data.underlying.symbol}, premium $${usdSmart(prem)}` : null
    },
    {
      n: "02", s: "Saturday, 03:10",
      beforeV: "A wick on a thin book", before: "A sale into a thin token book prints a price the share never traded at. The perp's mark follows it.", beforeFig: `mark −11% to $${usd(mark * 0.89)}`,
      afterV: "Nothing happens", after: "The token price moved. The contract did not. The holder is asleep and owes nobody anything.", afterFig: "position unchanged"
    },
    {
      n: "03", s: "Saturday, 03:11",
      beforeV: "Liquidated", before: "Margin below maintenance, the engine closes the position at the wick. The market will never confirm the price.", beforeFig: `$${usd0(margin)} margin gone, position closed`,
      afterV: "Still holding the upside", after: "Max loss is still the premium. Whatever the book does, the worst case was printed on Friday.", afterFig: call ? `max loss −$${usdSmart(prem)}` : null
    },
    {
      n: "04", s: "Monday, 09:30",
      beforeV: "The share opens higher", before: "The move the perp was liquidated on reverses at the open. The position that would have paid is gone.", beforeFig: `opens at $${usd(mark * 1.06)}`,
      afterV: "The contract is in the money", after: "The buyer can exercise now or hold to Friday. Exercising means paying the strike and receiving the tokens.", afterFig: call ? `intrinsic $${usdSmart(Math.max(0, mark * 1.06 - call.strike) * shares)} on ${shares} ${data.underlying.symbol}` : null
    },
    {
      n: "05", s: "The outcome",
      beforeV: "Nothing left", before: "The whole margin, taken on a move the market never confirmed, on an asset whose market was closed.", beforeFig: null,
      afterV: "Premium was the worst case", after: "Up, down or flat, the most the weekend could cost was known before the click. That is the whole product.", afterFig: null
    }
  ];

  return (
    <Sec id="problem" className="ba-sec">
      <div style={{ padding: "80px 30px", display: "flex", flexDirection: "column", alignItems: "center", gap: 60 }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, width: "100%" }}>
          <Reveal y={18} style={{ width: "100%" }}><p className="body" style={{ margin: 0, textAlign: "center", color: "var(--ink-2)" }}>The problem, told plainly</p></Reveal>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20 }}>
            <ScrollColorText as="h2" text="A perp can take your whole position on a wick you never saw." className="h-section" style={{ maxWidth: 900, textAlign: "center" }} />
            <Reveal y={18} delay={0.2}><p className="body" style={{ margin: 0, maxWidth: 672, textAlign: "center" }}>Tokenized stocks trade 168 hours a week. The shares behind them trade 32.5, about 19% of the week. In the 75 hours between Friday&apos;s close and Monday&apos;s open, the token book is thin, the share has no price, and a leveraged position can be liquidated on a move the market will never confirm.</p></Reveal>
          </div>
        </div>
        <div style={{ width: "100%" }}>
          <div className="ba">
            <Reveal y={20} className="ba-head">
              <div className="ba-title before">
                <span className="ba-when">Today</span>
                <div className="h-item">A perp over the weekend</div>
                <p className="note">The engine sees a mark and defends it with your margin.</p>
              </div>
              <div className="ba-spine" aria-hidden />
              <div className="ba-title after">
                <span className="ba-when">The same weekend</span>
                <div className="h-item">A Gap over the weekend</div>
                <p className="note">The contract sees a strike and an expiry. Nothing else.</p>
              </div>
            </Reveal>
            {stages.map((st, j) => (
              <Reveal key={st.n} y={32} delay={0.1 + j * 0.1} className="ba-row">
                <div className="ba-cell before">
                  <span className="ba-when">A perp</span>
                  <span className="ba-mark"><i aria-hidden>–</i>{st.beforeV}</span>
                  <p>{st.before}</p>
                  {st.beforeFig ? <span className="ba-fig mono">{st.beforeFig}</span> : null}
                </div>
                <div className="ba-step">
                  <span className="n">{st.n}</span>
                  <span className="s">{st.s}</span>
                </div>
                <div className="ba-cell after">
                  <span className="ba-when">A Gap</span>
                  <span className="ba-mark"><i aria-hidden>✓</i>{st.afterV}</span>
                  <p>{st.after}</p>
                  {st.afterFig ? <span className="ba-fig mono">{st.afterFig}</span> : null}
                </div>
              </Reveal>
            ))}
            <Reveal y={32} delay={0.6} className="ba-foot">
              <div className="ba-out before">
                <div className="v num">−${usd0(margin)}</div>
                <div className="note">the whole margin of a 10x perp on {shares} {data.underlying.symbol}, gone on an 11% wick</div>
              </div>
              <div className="ba-arrow" aria-hidden>→</div>
              <div className="ba-out after">
                <div className="v num">−${usdSmart(prem)}</div>
                <div className="note">the most a Gap on the same {shares} {data.underlying.symbol} can lose, whatever the wick does. Fees on top, disclosed on the ticket.</div>
              </div>
            </Reveal>
          </div>
        </div>
      </div>
    </Sec>
  );
}
