"use client";

import { useState } from "react";
import { Reveal, ScrollColorText, Stagger } from "@/components/motion";
import { PayoffChart } from "@/components/payoff-chart";
import { Tabs } from "@/components/ui";
import { usd, usd0, usdSmart } from "@/lib/format";
import { buyerPnl, commitMath, type RosterData } from "@/lib/model";

/*
 * The instrument, centred in the frame the reference uses for its illustrations: three worked examples with real
 * numbers from the live quoter and a payoff sketch (CLAUDE.md 6, "What you can do here"). Gap on 10 NVDAx, Floor on
 * 20 NVDAx, Commit on the Floor's other side; the figures recompute from the nearest expiry's $180 terms.
 */
export function Examples({ data }: { data: RosterData }) {
  const [tab, setTab] = useState<"gap" | "floor" | "commit">("gap");
  const near = data.expiries[0] ?? data.nowTs;
  const call = data.terms.find((t) => t.side === "call" && t.strike === 180 && t.expiryTs === near) ?? data.terms.find((t) => t.side === "call") ?? null;
  const put = data.terms.find((t) => t.side === "put" && t.strike === 180 && t.expiryTs === near) ?? data.terms.find((t) => t.side === "put") ?? null;
  const mark = data.underlying.mark;
  const sym = data.underlying.symbol;
  const [expected, setExpected] = useState(198);

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
                <Tabs value={tab} onChange={(v) => setTab(v as typeof tab)} items={[{ id: "gap", label: "Gap" }, { id: "floor", label: "Floor" }, { id: "commit", label: "Commit" }]} />
                <span className="small">Mark <b className="mono ink">${usd(mark)}</b> · through Friday</span>
              </div>
              {tab === "gap" && call ? (
                <Example key="gap" title="Buy the upside." lead={`Pay $${usdSmart(call.ask * 10)} for the right to buy 10 ${sym} at $${usd0(call.strike)} through Friday.`}
                  verdict={<>If it opens at <b>${usd0(expected)}</b>, you&apos;re {buyerPnl("call", call.strike, call.ask, 10, expected) >= 0 ? "up" : "down"} <b>${usdSmart(Math.abs(buyerPnl("call", call.strike, call.ask, 10, expected)))}</b>. If it doesn&apos;t get there, you lost <b>${usdSmart(call.ask * 10)}</b> and nothing else.</>}
                  rows={[["Premium", `$${usd(call.ask)} per share`], ["Cost", `$${usdSmart(call.ask * 10)}`], ["Break-even", `$${usd(call.strike + call.ask)}`], ["Maximum loss", `$${usdSmart(call.ask * 10)} plus fees`]]}>
                  <PayoffChart side="call" strike={call.strike} premium={call.ask} shares={10} mark={mark} expected={expected} />
                  <Slider value={expected} min={Math.round(mark * 0.8)} max={Math.round(mark * 1.2)} onChange={setExpected} label="Expected price on Friday" />
                </Example>
              ) : null}
              {tab === "floor" && put ? (
                <Example key="floor" title="Buy an exit." lead={`Pay $${usdSmart(put.ask * 20)} for the right to sell 20 ${sym} at $${usd0(put.strike)} any time through Friday, backed by $${usd0(put.strike * 20)} already locked.`}
                  verdict={<>Nothing else on earth sells a Saturday exit on Nvidia. At <b>${usd0(expected)}</b> the floor is worth <b>${usdSmart(Math.max(0, put.strike - expected) * 20)}</b>; the most it can cost you is <b>${usdSmart(put.ask * 20)}</b>.</>}
                  rows={[["Premium", `$${usd(put.ask)} per share`], ["Cost", `$${usdSmart(put.ask * 20)}`], ["Exit price", `$${usd0(put.strike)} per share, ${20} ${sym}`], ["Locked behind it", `$${usd0(put.strike * 20)} USDC in escrow`]]}>
                  <PayoffChart side="put" strike={put.strike} premium={put.ask} shares={20} mark={mark} expected={expected} />
                  <Slider value={expected} min={Math.round(mark * 0.8)} max={Math.round(mark * 1.2)} onChange={setExpected} label="Expected price on Friday" />
                </Example>
              ) : null}
              {tab === "commit" && put ? (
                <CommitExample put={put} sym={sym} />
              ) : null}
            </div>
            <p className="note" style={{ marginTop: 10 }}>{data.source}</p>
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

function CommitExample({ put, sym }: { put: { strike: number; ask: number }; sym: string }) {
  const m = commitMath("put", put.strike, put.ask, 20);
  const adverse = [put.strike * 0.95, put.strike * 0.9, put.strike * 0.8];
  return (
    <Stagger step={0.1}>
      <div style={{ marginTop: 18 }}>
        <div className="h-item">Get paid to take the other side.</div>
        <p className="body" style={{ margin: "6px 0 0" }}>Lock ${usd0(m.locked)}, collect ${usd0(m.premium)}, and either keep it or buy Nvidia at ${usd0(put.strike)}. Paid risk, disclosed as such.</p>
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
    <label className="flex items-center gap-3 small" style={{ marginTop: 10, padding: "0 4px" }}>
      <span style={{ whiteSpace: "nowrap" }}>{label}</span>
      <input type="range" min={min} max={max} step={1} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ flex: 1, accentColor: "var(--ink)" }} aria-label={label} />
      <span className="mono ink" style={{ minWidth: 48, textAlign: "right" }}>${value}</span>
    </label>
  );
}
