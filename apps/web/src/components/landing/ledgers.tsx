"use client";

import Image from "next/image";
import Link from "next/link";
import { Reveal, Roll, ScrollColorText } from "@/components/motion";
import { usd, usd0, usdSmart, dayLabel } from "@/lib/format";
import type { RosterData } from "@/lib/model";
import { Sec } from "./sec";

/*
 * Proof of executable protection, in the reference's account-statement layout: quotes at three sizes, the capital
 * reserved behind them with the accounts, and the exercise history including failures. A venue that publishes
 * whether its promises are funded is a venue that expects to be checked.
 */
export function RosterProof({ data }: { data: RosterData }) {
  const near = data.expiries[0] ?? data.nowTs;
  const call = data.terms.find((t) => t.side === "call" && t.expiryTs === near && t.ladder[0]?.ask !== null) ?? data.terms.find((t) => t.side === "call" && t.ladder.some((r) => r.ask !== null)) ?? data.terms[0];
  const sym = data.underlying.symbol;
  const live = data.underwriters.filter((u) => u.live);
  const depth = data.markets.reduce((a, m) => a + m.depthUsdc, 0);
  const usdcReserved = data.underwriters.reduce((a, u) => a + u.usdcReserved, 0);
  const tokReserved = data.underwriters.reduce((a, u) => a + u.underlyingReserved, 0);
  const short = (v: string) => `${v.slice(0, 4)}…${v.slice(-4)}`;
  const day = (ts: number) => new Date(ts * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

  return (
    <Sec id="roster" className="connect">
      <div style={{ padding: "80px 0", display: "flex", flexDirection: "column", alignItems: "center", gap: 56, position: "relative" }}>
        <Image src="/aoutive/6vPEjmr5mSVqv6nCvhHqm3RCVo.png" alt="" width={1224} height={891} unoptimized aria-hidden style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.35, pointerEvents: "none" }} />
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, width: "100%", position: "relative" }}>
          <Reveal y={18} style={{ width: "100%" }}><p className="body" style={{ margin: 0, color: "var(--ink-2)", textAlign: "center" }}>Proof of executable protection</p></Reveal>
          <ScrollColorText as="h2" text="Every promise, funded before you click." className="h-section" style={{ maxWidth: 697, textAlign: "center" }} />
          <Reveal y={18} delay={0.2}><p className="body" style={{ margin: "10px auto 0", maxWidth: 640, textAlign: "center" }}>The live roster: quotes at three sizes, USDC and {sym} reserved with the accounts, capacity, and the exercise history. A venue that publishes whether its promises are funded is a venue that expects to be checked.</p></Reveal>
        </div>
        <Reveal y={48} style={{ width: "100%", maxWidth: 1110, position: "relative" }}>
          <div className="pf">
            <div className="pf-strip">
              <div><span className="k">Executable depth</span><span className="v">${usd0(depth)}</span><span className="s">{data.markets.length} listed market{data.markets.length === 1 ? "" : "s"}</span></div>
              <div><span className="k">USDC reserved on {sym}</span><span className="v">${usd0(usdcReserved)}</span><span className="s">backing Floors</span></div>
              <div><span className="k">{sym} reserved</span><span className="v">{Math.floor(tokReserved).toLocaleString("en-US")}</span><span className="s">backing Upsides</span></div>
              <div><span className="k">Makers live</span><span className="v">{live.length}</span><span className="s">{live.length ? "quoting now" : "none yet on this cluster"}</span></div>
            </div>
            <div className="pf-grid">
              <div className="pf-col">
                <div className="pf-title">Quotes at size</div>
                <div className="pf-sub">{call ? `Upside $${usd0(call.strike)} through ${dayLabel(call.expiryTs)}` : "no live term"}</div>
                <table className="pf-table">
                  <thead><tr><th>Size</th><th className="num">Per share</th><th className="num">Cost</th><th className="num">Makers in fill</th></tr></thead>
                  <tbody>
                      {(call?.ladder ?? []).map((r) => (
                        <tr key={r.size}>
                          <td className="mono">{r.size} <span className="muted">{sym}</span></td>
                          <td className="num mono">{r.ask === null ? <span className="muted">–</span> : `$${usd(r.ask)}`}</td>
                          <td className="num mono">{r.ask === null ? <span className="muted">not fillable</span> : `$${usdSmart(r.ask * r.size)}`}</td>
                          <td className="num mono">{r.ask === null ? <span className="muted">–</span> : r.underwriters}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              <div className="pf-col">
                <div className="pf-title">Reserved capital</div>
                <div className="pf-sub">in program-owned vaults, per maker</div>
                <table className="pf-table">
                  <thead><tr><th>Maker</th><th className="num">USDC</th><th className="num">{sym}</th><th className="num col-acct">Account</th></tr></thead>
                  <tbody>
                      {live.length === 0 ? <tr><td colSpan={4} className="muted">No maker has quoted yet.</td></tr> : live.map((u) => (
                        <tr key={u.name}>
                          <td>{u.name}</td>
                          <td className="num mono">${usd0(u.usdcReserved)}</td>
                          <td className="num mono">{Math.floor(u.underlyingReserved).toLocaleString("en-US")}</td>
                          <td className="num mono col-acct">{u.account ? short(u.account) : "linked at deploy"}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              <div className="pf-col">
                <div className="pf-title">Exercise history</div>
                <div className="pf-sub">every exercise, including the ones that declined</div>
                <table className="pf-table">
                  <thead><tr><th>Date</th><th>Event</th><th className="num">Size</th><th className="num">Signature</th></tr></thead>
                  <tbody>
                      {data.exercises.length === 0 ? <tr><td colSpan={4} className="muted">No exercises yet on this cluster.</td></tr> : data.exercises.slice(0, 4).map((e, i) => (
                        <tr key={i}>
                          <td className="mono">{day(e.ts)}</td>
                          <td><span className={e.ok ? "" : "muted"}>{e.kind === "auto_exercise" ? "Auto-exercise" : e.kind === "release" ? "Release" : "Exercise"}</span>{e.ok ? "" : " declined"}</td>
                          <td className="num mono">{e.shares} {sym}</td>
                          <td className="num mono">{e.signature ? short(e.signature) : "–"}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="pf-foot">
              <div><b>Quotes are executable.</b> Each one is backed by escrow at the size shown, not by a promise to find a counterparty.</div>
              <div><b>Reserves are on-chain.</b> Every vault is a program-owned account you can open.</div>
              <div><b>Failures are listed.</b> An auto-exercise that declined sits next to one that paid.</div>
            </div>
            <div className="btnrow" style={{ marginTop: 28, justifyContent: "center" }}>
              <Link href="/roster" className="btn secondary"><Roll>Open the roster</Roll></Link>
            </div>
          </div>
        </Reveal>
      </div>
    </Sec>
  );
}
