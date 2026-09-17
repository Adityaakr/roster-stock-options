"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge, Empty, ErrorState, KV, Loading, Stat } from "@/components/ui";
import { useCluster } from "@/lib/cluster";
import { usd, usd0, usdSmart, dayLabel, countdown } from "@/lib/format";
import { buyerPnl, exerciseWords, inTheMoney, productName } from "@/lib/model";
import { useRoster } from "@/lib/use-roster";

/*
 * Manage (CLAUDE.md 5): per position, side, shares and strike in display terms, the countdown, the mark with the basis,
 * in the money or not, what exercising requires in plain words, and the auto-exercise rule. Actions: exercise now
 * (restating the exchange), partial exercise, nothing else until expiry.
 */
export default function PositionsPage() {
  const { data, error } = useRoster();
  const cluster = useCluster();
  const [confirm, setConfirm] = useState<string | null>(null);
  const [partial, setPartial] = useState<Record<string, number>>({});

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="h3">Positions</h1>
          <p className="body-sm">What you own, what it is worth now, how long until expiry, and exactly what exercising requires.</p>
        </div>
        <Link href="/trade" className="btn primary sm">Buy another</Link>
      </div>
      {error ? <ErrorState message={`Could not read positions: ${error}`} next="Reload the page." /> : null}
      {!data && !error ? <Loading what="positions" /> : null}
      {data && data.positions.length === 0 ? <Empty title="No positions on this cluster" action="Buy a Gap or a Floor from the terms and it appears here with its countdown and its exercise terms." cta={<Link href="/trade" className="btn primary">See the terms</Link>} /> : null}
      {data && data.positions.length > 0 ? (
        <>
          <div className="grid-4" style={{ marginBottom: 16 }}>
            <Stat k="Open positions" v={String(data.positions.length)} />
            <Stat k="Premium paid" v={`$${usdSmart(data.positions.reduce((a, p) => a + p.premiumPaid, 0))}`} s="the most these can lose, plus fees" />
            <Stat k={`${data.underlying.symbol} mark`} v={`$${usd(data.underlying.mark)}`} s={data.underlying.basisBps === null ? "basis n/a, equity feed closed" : `basis ${data.underlying.basisBps >= 0 ? "+" : ""}${data.underlying.basisBps} bps`} />
            <Stat k="In the money" v={String(data.positions.filter((p) => inTheMoney(p.side, p.strike, data.underlying.mark)).length)} s={`of ${data.positions.length}, at the current mark`} />
          </div>
          <div className="card">
            {data.positions.map((p) => {
              const itm = inTheMoney(p.side, p.strike, data.underlying.mark);
              const remaining = p.shares - p.exercised;
              const value = buyerPnl(p.side, p.strike, 0, remaining, data.underlying.mark);
              const n = partial[p.id] ?? remaining;
              const words = exerciseWords(p.side, p.strike, n, data.underlying.symbol, (v) => usd0(v));
              return (
                <div key={p.id} style={{ padding: "18px 20px", borderBottom: "1px solid var(--line)" }} className="flex items-start justify-between gap-4 flex-wrap">
                  <div style={{ minWidth: 0, flex: "1 1 360px" }}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link href={`/trade/${p.termId}`} className="h6">{productName(p.side)} at ${usd0(p.strike)} · {remaining} {data.underlying.symbol}</Link>
                      <Badge tone={itm ? "green" : "amber"} dot>{itm ? "in the money" : "out of the money"}</Badge>
                      <Badge>{dayLabel(p.expiryTs)} · {countdown(p.expiryTs, data.nowTs)}</Badge>
                    </div>
                    <div className="small" style={{ marginTop: 8 }}>
                      <KV items={[
                        { k: "Premium paid", v: <span className="mono">${usdSmart(p.premiumPaid)}</span> },
                        { k: "Intrinsic value now", v: <span className={`mono ${value > 0 ? "up" : ""}`}>${usdSmart(value)}</span> },
                        { k: "Exercising requires", v: <span className="mono">{words}</span> },
                        { k: "Auto-exercise", v: `after expiry minus grace if in the money by more than $${usd(data.keeperFeeUsd)}` },
                        { k: "Bought", v: <span className="mono">{p.signature ?? "no signature on this cluster"}</span> }
                      ]} />
                    </div>
                  </div>
                  <div style={{ display: "grid", gap: 8, justifyItems: "end" }}>
                    <div className="h4 num">{remaining} <span className="small">{data.underlying.symbol}</span></div>
                    {confirm === p.id ? (
                      <div className="inset" style={{ padding: 12, maxWidth: 320 }}>
                        <div className="small">Exercise {n} of {remaining}: {words}.</div>
                        <div className="flex items-center gap-2" style={{ marginTop: 8 }}>
                          <input className="field mono" type="number" min={1} max={remaining} value={n} onChange={(e) => setPartial({ ...partial, [p.id]: Math.min(remaining, Math.max(1, Math.floor(Number(e.target.value) || 1))) })} style={{ width: 90, height: 34 }} aria-label="Shares to exercise" />
                          <button className="btn primary sm" disabled={!cluster.programDeployed}>Confirm</button>
                          <button className="btn secondary sm" onClick={() => setConfirm(null)}>Cancel</button>
                        </div>
                        {!cluster.programDeployed ? <div className="msg red" style={{ marginTop: 8 }}>Program not deployed on {cluster.label}; nothing to sign yet.</div> : null}
                      </div>
                    ) : (
                      <button className="btn secondary sm" onClick={() => setConfirm(p.id)} disabled={remaining === 0}>Exercise now</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="small" style={{ marginTop: 14 }}>{data.source}</p>
        </>
      ) : null}
    </div>
  );
}
