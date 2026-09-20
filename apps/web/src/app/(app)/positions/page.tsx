"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { TxStatus } from "@/components/tx-status";
import { Address, Badge, Empty, ErrorState, KV, Loading, Stat } from "@/components/ui";
import { useCluster, explorerUrl } from "@/lib/cluster";
import { usd, usd0, usdK, usdSmart, dayLabel, countdown, timeLabel } from "@/lib/format";
import { buyerPnl, exerciseWords, inTheMoney, lots6ForShares, productName, sharesOf, type Market, type Position } from "@/lib/model";
import { useTransaction } from "@/lib/tx";
import { usePositions } from "@/lib/use-positions";
import { useRoster } from "@/lib/use-roster";

/*
 * Manage (CLAUDE.md 5, Part 2 section 6): per position, side, shares and strike in display terms, the countdown, the
 * mark with the basis, in the money or not, what exercising requires in plain words, and the auto-exercise delegate
 * with revoke. Actions: exercise now (restating the exchange), partial exercise, enable or disable auto-exercise.
 */
export default function PositionsPage() {
  const { data, error } = useRoster();
  const cluster = useCluster();
  const { publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const { positions, history, error: perror, reload } = usePositions();
  const list = data?.cluster === "fixture" ? data.positions : positions;
  const markets = new Map((data?.markets ?? []).map((m) => [m.symbol, m]));

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="h3">Positions</h1>
          <p className="body-sm">What you own across every market, what it is worth now, how long until expiry, and exactly what exercising requires.</p>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn secondary sm" onClick={reload} data-testid="refresh">Refresh</button>
          <Link href="/markets" className="btn primary sm">Buy another</Link>
        </div>
      </div>
      {error || perror ? <ErrorState message={`Could not read positions: ${error ?? perror}`} next="Reload the page." /> : null}
      {!data && !error ? <Loading what="positions" /> : null}
      {data && data.cluster !== "fixture" && !publicKey ? <Empty title="Connect a wallet" action="Positions are read from the wallet's position tokens, so there is nothing to show until one is connected." cta={<button className="btn primary" onClick={() => setVisible(true)}>Connect wallet</button>} /> : null}
      {data && list && list.length === 0 && history.length === 0 && (publicKey || data.cluster === "fixture") ? <Empty title="No positions" action="Buy a Gap or a Floor from the terms and it appears here with its countdown and its exercise terms." cta={<Link href="/markets" className="btn primary">See the terms</Link>} /> : null}
      {data && list && list.length > 0 ? (
        <>
          <div className="grid-4" style={{ marginBottom: 16 }}>
            <Stat k="Open positions" v={String(list.filter((p) => !p.expired).length)} s={list.some((p) => p.expired) ? `${list.filter((p) => p.expired).length} expired` : undefined} />
            <Stat k="Premium paid" v={`$${usdSmart(list.reduce((a, p) => a + p.premiumPaid, 0))}`} s="the most these can lose, plus fees" />
            <Stat k="In the money" v={String(list.filter((p) => { const m = markets.get(p.market); return m?.mark !== null && m?.mark !== undefined && inTheMoney(p.side, p.strike, m.mark); }).length)} s={`of ${list.length}, at the current marks`} />
            <Stat k="Auto-exercise on" v={String(list.filter((p) => p.autoExercise).length)} s="positions with the delegate enabled" />
          </div>
          <div className="card">
            {list.map((p) => <PositionRow key={p.id} p={p} market={markets.get(p.market)} nowTs={data.nowTs} keeperFeeUsd={data.keeperFeeUsd} programDeployed={cluster.programDeployed} autoExerciseLive={data.autoExerciseLive} onChange={reload} />)}
          </div>
        </>
      ) : null}
      {data && publicKey && history.length > 0 ? (
        <div className="card" style={{ marginTop: 16 }} data-testid="history">
          <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--line)" }}>
            <div className="h6">History and receipts</div>
            <div className="small" style={{ marginTop: 4 }}>Every buy, exercise, quote, claim, withdrawal and release for this wallet, from the program&apos;s own events, with the signature.</div>
          </div>
          <div className="scroll-x">
            <table className="table">
              <thead><tr><th>When</th><th>Event</th><th>Detail</th><th>Signature</th></tr></thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.signature + h.kind} data-kind={h.kind}>
                    <td className="small mono">{timeLabel(h.ts)}</td>
                    <td><Badge tone={h.kind === "release" || h.kind === "exercise" || h.kind === "auto_exercise" ? "green" : undefined} dot={h.kind === "release"}>{RECEIPT_LABEL[h.kind]}</Badge> {h.termId ? <Link className="small" href={`/trade/${h.termId}`}>{h.market}</Link> : <span className="small muted">{h.market || "closed series"}</span>}</td>
                    <td className="small">{h.note}</td>
                    <td className="small"><Address value={h.signature} n={6} href={explorerUrl(cluster, "tx", h.signature)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
      {data ? <p className="small" style={{ marginTop: 14 }}>{data.source}</p> : null}
    </div>
  );
}

const RECEIPT_LABEL: Record<string, string> = { buy: "Bought", exercise: "Exercised", auto_exercise: "Auto-exercised", claim: "Premium claimed", withdraw: "Withdrawn", release: "Released", quote: "Quoted" };

function PositionRow({ p, market, nowTs, keeperFeeUsd, programDeployed, autoExerciseLive, onChange }: { p: Position; market: Market | undefined; nowTs: number; keeperFeeUsd: number; programDeployed: boolean; autoExerciseLive: boolean; onChange: () => void }) {
  const tx = useTransaction();
  const auto = useTransaction();
  const sell = useTransaction();
  const [confirm, setConfirm] = useState(false);
  const [n, setN] = useState<number | null>(null);
  // The vault's live bid on this series (Part 3): the way out of a winning position without paying the strike.
  const [bid, setBid] = useState<{ vault: string; perShare: number; maxShares: number; expiresAt: number } | null>(null);
  useEffect(() => {
    if (!p.series || !market?.address) return;
    let live = true;
    fetch("/api/vaults", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<{ address: string; symbol: string; kind: string }[]>) : []))
      .then(async (vaults) => {
        const v = Array.isArray(vaults) ? vaults.find((x) => x.symbol === p.market && x.kind === (p.side === "call" ? "covered_call" : "cash_secured_put")) : undefined;
        if (!v) return null;
        const b = await fetch(`/api/vaults/${v.address}/bid/${p.series}`, { cache: "no-store" }).then((r) => (r.ok ? (r.json() as Promise<{ bidPerLot: string; maxLots6: string; expiresAt: number } | null>) : null));
        if (!b || Number(b.bidPerLot) <= 0 || b.expiresAt <= Math.floor(Date.now() / 1000)) return null;
        const mult = market?.multiplier ?? 1;
        return { vault: v.address, perShare: Number(b.bidPerLot) / 1e6 / mult, maxShares: sharesOf(b.maxLots6, mult), expiresAt: b.expiresAt };
      })
      .then((b) => { if (live) setBid(b); })
      .catch(() => { if (live) setBid(null); });
    return () => { live = false; };
    // Not keyed on the clock: a refresh must not cancel a bid read in flight. The bid itself carries its expiry.
  }, [p.series, p.market, p.side, market?.address, market?.multiplier]);
  const mark = market?.mark ?? null;
  const symbol = p.market;
  const itm = mark !== null && inTheMoney(p.side, p.strike, mark);
  const remaining = p.shares - p.exercised;
  const value = mark === null ? null : buyerPnl(p.side, p.strike, 0, remaining, mark);
  const count = Math.min(remaining, Math.max(1, n ?? remaining));
  const words = exerciseWords(p.side, p.strike, count, symbol, (v) => usd0(v));
  const busy = (s: { status: string }) => s.status === "building" || s.status === "signing" || s.status === "sending";
  const can = programDeployed && !!p.series && !!market?.mint && !p.expired && remaining > 0;

  async function exercise() {
    if (!p.series || !market?.mint) return;
    const sig = await tx.run({ kind: "exercise", mint: market.mint, series: p.series, params: { lots6: lots6ForShares(count, market.multiplier).toString() } });
    if (sig) { setConfirm(false); onChange(); }
  }
  async function sellToVault() {
    if (!p.series || !market?.mint || !bid) return;
    const shares = Math.min(count, bid.maxShares, remaining);
    // The limit is the bid shown, less a hair for the multiplier's rounding: the program refuses anything below it.
    const minPerLot = BigInt(Math.floor(bid.perShare * (market.multiplier ?? 1) * 1e6 * 0.999));
    const sig = await sell.run({ kind: "sell_to_vault", mint: market.mint, series: p.series, params: { lots6: lots6ForShares(shares, market.multiplier).toString(), minBidPerLot: minPerLot.toString() } });
    if (sig) { setConfirm(false); onChange(); }
  }
  async function toggleAuto() {
    if (!p.series || !market?.mint) return;
    const sig = await auto.run({ kind: p.autoExercise ? "disable_auto_exercise" : "enable_auto_exercise", mint: market.mint, series: p.series, params: { minItmBps: 0 } });
    if (sig) onChange();
  }

  return (
    <div style={{ padding: "18px 20px", borderBottom: "1px solid var(--line)" }} className="flex items-start justify-between gap-4 flex-wrap" data-testid="position" data-term={p.termId}>
      <div style={{ minWidth: 0, flex: "1 1 360px" }}>
        <div className="flex items-center gap-2 flex-wrap">
          <Link href={`/trade/${p.termId}`} className="h6">{symbol} {productName(p.side)} at ${usdK(p.strike)} · {remaining} {symbol}</Link>
          {p.expired ? <Badge tone="amber" dot>expired</Badge> : <Badge tone={itm ? "green" : "amber"} dot>{mark === null ? "no feed" : itm ? "in the money" : "out of the money"}</Badge>}
          <Badge>{dayLabel(p.expiryTs)} · {p.expired ? "settled by the term" : countdown(p.expiryTs, nowTs)}</Badge>
        </div>
        <div className="small" style={{ marginTop: 8 }}>
          <KV items={[
            { k: "Premium paid", v: <span className="mono">${usdSmart(p.premiumPaid)}</span> },
            { k: "Intrinsic value now", v: <span className={`mono ${value !== null && value > 0 ? "up" : ""}`}>{value === null ? "no feed" : `$${usdSmart(value)}`}</span> },
            { k: "Exercising requires", v: <span className="mono">{words}</span> },
            { k: "Auto-exercise", v: p.autoExercise ? (autoExerciseLive ? `on: the keeper exercises in the hour before expiry if in the money by more than $${usd(keeperFeeUsd)}, paid from the fee vault` : `on: the delegate is set, but no keeper cranks on this cluster yet (it needs a Pyth key), so exercise yourself before expiry`) : "off: nothing happens at expiry unless you exercise" },
            { k: "Bought", v: <span className="mono">{p.signature ? `${p.signature.slice(0, 8)}…${p.signature.slice(-8)}` : "no signature on this cluster"}</span> },
            { k: "Vault bid", v: bid ? <span className="mono">${usdSmart(bid.perShare)} per share for up to {usdK(bid.maxShares)} {symbol}: sell without paying the strike</span> : <span className="muted">none right now; exercise or hold to expiry</span> },
            ...(p.exercised > 0 ? [{ k: "Exercised so far", v: <span className="mono">{p.exercised} {symbol}</span> }] : [])
          ]} />
        </div>
        <TxStatus state={auto.state} onRetry={auto.reset} />
      </div>
      <div style={{ display: "grid", gap: 8, justifyItems: "end" }}>
        <div className="h4 num">{remaining} <span className="small">{symbol}</span></div>
        {confirm ? (
          <div className="inset" style={{ padding: 12, maxWidth: 340 }}>
            <div className="small">Exercise {count} of {remaining}: {words}.</div>
            <div className="flex items-center gap-2" style={{ marginTop: 8 }}>
              <input className="field mono" type="number" min={1} max={remaining} value={count} onChange={(e) => setN(Math.min(remaining, Math.max(1, Math.floor(Number(e.target.value) || 1))))} style={{ width: 90, height: 34 }} aria-label="Shares to exercise" data-testid="exercise-size" />
              <button className="btn primary sm" disabled={!can || busy(tx.state)} onClick={exercise} data-testid="exercise-confirm">Confirm</button>
              <button className="btn secondary sm" onClick={() => { setConfirm(false); tx.reset(); }}>Cancel</button>
            </div>
            {!programDeployed ? <div className="msg red" style={{ marginTop: 8 }}>Program not deployed on this cluster; nothing to sign yet.</div> : null}
            <TxStatus state={tx.state} onRetry={tx.reset} />
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button className="btn secondary sm" onClick={toggleAuto} disabled={!can || busy(auto.state)} data-testid="auto-toggle">{p.autoExercise ? "Revoke auto-exercise" : "Enable auto-exercise"}</button>
            <button className="btn secondary sm" onClick={() => setConfirm(true)} disabled={remaining === 0 || p.expired} data-testid="exercise">Exercise now</button>
            {bid && bid.maxShares > 0 ? <button className="btn primary sm" onClick={sellToVault} disabled={!can || busy(sell.state)} data-testid="sell-to-vault">Sell {Math.min(count, bid.maxShares, remaining)} at ${usdSmart(bid.perShare)}</button> : null}
          </div>
        )}
        {sell.state.status !== "idle" ? <TxStatus state={sell.state} onRetry={sell.reset} /> : null}
        {tx.state.status === "done" && !confirm ? <TxStatus state={tx.state} /> : null}
      </div>
    </div>
  );
}
