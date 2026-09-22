"use client";

import { useState } from "react";
import { Reveal, ScrollColorText, Stagger } from "@/components/motion";
import { PayoffChart } from "@/components/payoff-chart";
import { Tabs } from "@/components/ui";
import { usd, usd0, usdK, usdSmart } from "@/lib/format";
import { buyerPnl, commitMath, type RosterData } from "@/lib/model";

/*
 * The instrument, centred in the frame the reference uses for its illustrations: three worked examples with real
 * numbers from the live quoter and a payoff sketch (CLAUDE.md 6, "What you can do here"). Upside on 10 NVDAx, Floor on
 * 20 NVDAx, Commit on the Floor's other side; the figures recompute from the nearest expiry's $180 terms.
 */
export function Examples({ data }: { data: RosterData }) {
  const [tab, setTab] = useState<"gap" | "floor" | "commit">("gap");
  const near = data.expiries[0] ?? data.nowTs;
  // Only a term someone can actually buy: a term with no resident ask would print a $0 premium and a $0 max loss.
  const quoted = (side: "call" | "put") => data.terms.filter((t) => t.side === side && t.ask > 0 && !t.halted).sort((a, b) => a.expiryTs - b.expiryTs || Math.abs(a.strike - data.underlying.mark) - Math.abs(b.strike - data.underlying.mark));
  const call = quoted("call").find((t) => t.expiryTs === near) ?? quoted("call")[0] ?? null;
  const put = quoted("put").find((t) => t.expiryTs === near) ?? quoted("put")[0] ?? null;
  const mark = data.underlying.mark;
  const sym = data.underlying.symbol;
  const name = data.underlying.name.replace(/\s+xStock$/i, "");
  // The expected price follows the market shown: it is held as a fraction of the mark, so the slider, the chart and
  // the sentence below them always speak about the same range whichever market the landing is on.
  const [ratio, setRatio] = useState(1.04);
  const lo = Math.round(mark * 0.8);
  const hi = Math.round(mark * 1.2);
  const shown = Math.min(hi, Math.max(lo, Math.round(mark * ratio)));
  const setExpected = (v: number) => setRatio(mark > 0 ? v / mark : 1);

  return (
    <section className="asec" style={{ textAlign: "center", borderBottom: "1px solid var(--line)" }}>
      <div className="acontainer" style={{ padding: "80px 30px" }}>
        <span className="tick tl" aria-hidden /><span className="tick tr" aria-hidden />
        <Reveal y={18} style={{ width: "100%" }}><p className="body" style={{ margin: "0 0 10px", color: "var(--ink-2)" }}>What you can do here</p></Reveal>
        <ScrollColorText as="h2" text="Three trades, with the worst case printed first." className="h-section" style={{ margin: "0 auto", maxWidth: 760 }} />
        <Reveal y={18} delay={0.1}><p className="body" style={{ margin: "18px auto 0", maxWidth: 600 }}>Real numbers from the live quoter at the nearest expiry. Drag the expected price and watch the profit move while the maximum loss stays where it is.</p></Reveal>
        <Reveal y={48} delay={0.2}>
          <div id="examples" style={{ maxWidth: 760, margin: "48px auto 0", textAlign: "left" }}>
            <div className="wc" style={{ border: "1px solid var(--line)", borderRadius: 4 }}>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <Tabs value={tab} onChange={(v) => setTab(v as typeof tab)} items={[{ id: "gap", label: "Upside" }, { id: "floor", label: "Floor" }, { id: "commit", label: "Commit" }]} />
                <span className="small">Mark <b className="mono ink">${usd(mark)}</b> · through Friday</span>
              </div>
              {tab === "gap" && call ? (
                <Example key="gap" title="Buy the upside." lead={`Pay $${usdSmart(call.ask * 10)} for the right to buy 10 ${sym} at $${usdK(call.strike)} through Friday.`}
                  verdict={<>If it opens at <b>${usd0(shown)}</b>, you&apos;re {buyerPnl("call", call.strike, call.ask, 10, shown) >= 0 ? "up" : "down"} <b>${usdSmart(Math.abs(buyerPnl("call", call.strike, call.ask, 10, shown)))}</b>. If it doesn&apos;t get there, you lost <b>${usdSmart(call.ask * 10)}</b> and nothing else.</>}
                  rows={[["Premium", `$${usd(call.ask)} per share`], ["Cost", `$${usdSmart(call.ask * 10)}`], ["Break-even", `$${usd(call.strike + call.ask)}`], ["Maximum loss", `$${usdSmart(call.ask * 10)} plus fees`]]}>
                  <PayoffChart side="call" strike={call.strike} premium={call.ask} shares={10} mark={mark} expected={shown} />
                  <Slider value={shown} min={lo} max={hi} onChange={setExpected} label="Expected price on Friday" />
                </Example>
              ) : null}
              {tab === "floor" && put ? (
                <Example key="floor" title="Buy an exit." lead={`Pay $${usdSmart(put.ask * 20)} for the right to sell 20 ${sym} at $${usdK(put.strike)} any time through Friday, backed by $${usd0(put.strike * 20)} already locked.`}
                  verdict={<>No equity venue sells a Saturday exit on {name}. At <b>${usd0(shown)}</b> the floor is worth <b>${usdSmart(Math.max(0, put.strike - shown) * 20)}</b>; the most it can cost you is <b>${usdSmart(put.ask * 20)}</b>.</>}
                  rows={[["Premium", `$${usd(put.ask)} per share`], ["Cost", `$${usdSmart(put.ask * 20)}`], ["Exit price", `$${usdK(put.strike)} per share, ${20} ${sym}`], ["Locked behind it", `$${usd0(put.strike * 20)} USDC in escrow`]]}>
                  <PayoffChart side="put" strike={put.strike} premium={put.ask} shares={20} mark={mark} expected={shown} />
                  <Slider value={shown} min={lo} max={hi} onChange={setExpected} label="Expected price on Friday" />
                </Example>
              ) : null}
              {tab === "commit" && put ? (
                <CommitExample put={put} sym={sym} name={name} />
              ) : null}
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function Example({ title, lead, verdict, rows, children }: { title: string; lead: string; verdict: React.ReactNode; rows: [string, string][]; children: React.ReactNode }) {
  return (
    <Stagger step={0.1}>
      <div style={{ marginTop: 18 }}>
        <div className="h-item">{title}</div>
        <p className="body" style={{ margin: "6px 0 0" }}>{lead}</p>
      </div>
      <div style={{ marginTop: 16, padding: "16px 12px 8px", border: "1px solid var(--line)", borderRadius: 4, background: "var(--paper)" }}>{children}</div>
      <div className="wc-rows">
        {rows.map(([k, v]) => <div key={k} className="wc-row" style={{ gridTemplateColumns: "minmax(0, 1fr) auto" }}><span>{k}</span><span className="num mono">{v}</span></div>)}
      </div>
      <p className="wc-verdict">{verdict}</p>
    </Stagger>
  );
}

function CommitExample({ put, sym, name }: { put: { strike: number; ask: number }; sym: string; name: string }) {
  const m = commitMath("put", put.strike, put.ask, 20);
  const adverse = [put.strike * 0.95, put.strike * 0.9, put.strike * 0.8];
  return (
    <Stagger step={0.1}>
      <div style={{ marginTop: 18 }}>
        <div className="h-item">Get paid to take the other side.</div>
        <p className="body" style={{ margin: "6px 0 0" }}>Lock ${usd0(m.locked)}, collect ${usd0(m.premium)}, and either keep it or buy {name} at ${usdK(put.strike)}. Paid risk, disclosed as such.</p>
      </div>
      <div className="wc-rows">
        {([["You lock", `$${usd0(m.locked)} USDC until Friday or assignment`], ["You collect", `$${usd0(m.premium)} now, $${usd(put.ask)} per share`], ["Effective buy price if assigned", `$${usd(m.effective)} per share`]] as [string, string][]).map(([k, v]) => <div key={k} className="wc-row" style={{ gridTemplateColumns: "minmax(0, 1fr) auto" }}><span>{k}</span><span className="num mono">{v}</span></div>)}
        {adverse.map((p) => <div key={p} className="wc-row" style={{ gridTemplateColumns: "minmax(0, 1fr) auto" }}><span className="muted">If {sym} is at ${usd0(p)} on Friday</span><span className="num mono down">−${usdSmart((put.strike - p) * 20 - m.premium)}</span></div>)}
      </div>
      <p className="wc-verdict">Capital is locked until expiry or exercise. This is <b>paid risk</b>, never yield: the loss at ${usd0(adverse[2] ?? 0)} is real and it is yours.</p>
    </Stagger>
  );
}

export function Slider({ value, min, max, onChange, label }: { value: number; min: number; max: number; onChange: (v: number) => void; label: string }) {
  return (
    <label className="flex items-center gap-3 small pslider" style={{ marginTop: 10, padding: "0 4px" }}>
      <span style={{ whiteSpace: "nowrap" }}>{label}</span>
      <input type="range" min={min} max={max} step={1} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ flex: 1, accentColor: "var(--ink)" }} aria-label={label} />
      <span className="mono ink" style={{ minWidth: 64, textAlign: "right" }}>${value.toLocaleString("en-US")}</span>
    </label>
  );
}
