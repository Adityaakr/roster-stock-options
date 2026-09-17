"use client";

import Image from "next/image";
import Link from "next/link";
import { Reveal, Roll, ScrollColorText, Stagger } from "@/components/motion";
import { usd, usd0, usdSmart, dayLabel } from "@/lib/format";
import type { RosterData } from "@/lib/model";
import { Sec } from "./sec";

/*
 * Proof of executable protection, in the reference's account-statement layout: quotes at three sizes, the capital
 * reserved behind them with the accounts, and the exercise history including failures. A venue that publishes
 * whether its promises are funded is a venue that expects to be checked.
 */
interface Row {
  d: string;
  entry: string;
  note?: string;
  amount: string;
  balance: string;
  tone?: "in" | "out" | "flat" | "ok";
}

function Statement({ title, id, rows, ok, base, badge, cols }: { title: string; id: string; rows: Row[]; ok?: boolean; base?: number; badge?: string; cols: [string, string, string, string] }) {
  return (
    <div className={`stmt ${ok ? "ok" : ""}`}>
      <div className="stmt-head">
        <div>
          <div className="stmt-title">{title}</div>
          <div className="stmt-id mono">{id}</div>
        </div>
        {badge ? <span className="stmt-badge">{badge}</span> : null}
      </div>
      <div className="stmt-cols mono"><span>{cols[0]}</span><span>{cols[1]}</span><span className="r">{cols[2]}</span><span className="r">{cols[3]}</span></div>
      <Stagger step={0.12} base={base ?? 0}>
        {rows.map((r, i) => (
          <div key={`${r.d}-${i}`} className="stmt-row">
            <span className="mono d">{r.d}</span>
            <span className="e">{r.entry}{r.note ? <span className="n">{r.note}</span> : null}</span>
            <span className={`mono r a ${r.tone ?? ""}`}>{r.amount}</span>
            <span className="mono r b">{r.balance}</span>
          </div>
        ))}
      </Stagger>
    </div>
  );
}

export function RosterProof({ data }: { data: RosterData }) {
  const near = data.expiries[0] ?? data.nowTs;
  const call = data.terms.find((t) => t.side === "call" && t.strike === 180 && t.expiryTs === near) ?? data.terms[0];
  const sym = data.underlying.symbol;
  const quotes: Row[] = call ? call.ladder.map((r) => ({ d: `${r.size}`, entry: `Gap $${usd0(call.strike)} through ${dayLabel(call.expiryTs)}`, note: `${r.underwriters} underwriter${r.underwriters > 1 ? "s" : ""}, executable`, amount: `$${usd(r.ask)} / share`, balance: `$${usdSmart(r.ask * r.size)}`, tone: "in" })) : [];
  const reserves: Row[] = data.underwriters.filter((u) => u.live).flatMap((u) => [
    { d: "USDC", entry: u.name, note: u.account ?? "escrow account linked at deploy", amount: `$${usd0(u.usdcReserved)}`, balance: "reserved", tone: "in" as const },
    { d: sym, entry: u.name, note: u.account ?? "escrow account linked at deploy", amount: `${u.underlyingReserved} ${sym}`, balance: "reserved", tone: "in" as const }
  ]);
  const history: Row[] = data.exercises.length
    ? data.exercises.map((e) => ({ d: new Date(e.ts * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }), entry: e.kind === "auto_exercise" ? "Auto-exercise" : e.kind === "release" ? "Release" : "Exercise", note: e.note, amount: `${e.shares} ${sym}`, balance: e.signature ?? (e.ok ? "settled" : "declined"), tone: e.ok ? ("ok" as const) : ("flat" as const) }))
    : [{ d: "–", entry: "No exercises yet on this cluster", amount: "", balance: "", tone: "flat" as const }];

  return (
    <Sec id="roster" className="connect">
      <div style={{ padding: "80px 0", display: "flex", flexDirection: "column", alignItems: "center", gap: 85, position: "relative" }}>
        <Image src="/aoutive/6vPEjmr5mSVqv6nCvhHqm3RCVo.png" alt="" width={1224} height={891} unoptimized aria-hidden style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.35, pointerEvents: "none" }} />
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, width: "100%", position: "relative" }}>
          <Reveal y={18} style={{ width: "100%" }}><p className="body" style={{ margin: 0, color: "var(--ink-2)", textAlign: "center" }}>Proof of executable protection</p></Reveal>
          <ScrollColorText as="h2" text="Every promise, funded before you click." className="h-section" style={{ maxWidth: 697, textAlign: "center" }} />
          <Reveal y={18} delay={0.2}><p className="body" style={{ margin: "10px auto 0", maxWidth: 640, textAlign: "center" }}>The live roster: quotes at three sizes, USDC and {sym} reserved with the accounts, capacity, and the exercise history. A venue that publishes whether its promises are funded is a venue that expects to be checked.</p></Reveal>
        </div>
        <Reveal y={48} style={{ width: "100%", maxWidth: 1110, position: "relative" }}>
          <div>
            <div className="stmt-grid">
              <Statement title="Quotes at size" id={call ? call.id : "no term"} rows={quotes} cols={["Size", "Term", "Ask", "Cost"]} />
              <Statement title="Reserved capital" id={`${data.underwriters.filter((u) => u.live).length} underwriters live`} rows={reserves} base={0.4} cols={["Asset", "Underwriter", "Amount", "State"]} />
            </div>
            <div style={{ marginTop: 16 }}>
              <Statement title="Exercise history" id="including failures" rows={history} ok base={0.8} badge="on the roster" cols={["Date", "Event", "Size", "Result"]} />
            </div>
            <Reveal y={18} delay={0.2}>
              <div className="stmt-lines">
                {[
                  ["Quotes are executable.", "Each one is backed by escrow at the size shown, not by a promise to find a counterparty."],
                  ["Reserves are on-chain.", "The accounts are linked the moment the program deploys; until then the line says so."],
                  ["Failures are listed.", "An auto-exercise that declined sits next to one that paid."]
                ].map(([a, b]) => (
                  <div key={a} className="stmt-line"><span className="lead">{a}</span><span>{b}</span></div>
                ))}
              </div>
            </Reveal>
            <div className="btnrow" style={{ marginTop: 28, justifyContent: "center" }}>
              <Link href="/roster" className="btn secondary"><Roll>Open the roster</Roll></Link>
            </div>
          </div>
        </Reveal>
      </div>
    </Sec>
  );
}
