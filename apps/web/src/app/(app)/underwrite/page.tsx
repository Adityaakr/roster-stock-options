"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { TxStatus } from "@/components/tx-status";
import { Badge, ErrorState, KV, Loading, Tabs } from "@/components/ui";
import { useCluster } from "@/lib/cluster";
import { usd, usd0, usdK, usdSmart, dayLabel, countdown } from "@/lib/format";
import { commitMath, DEFAULT_SIZE, lots6ForShares, sharesOf, type Side, type Term } from "@/lib/model";
import { useTransaction } from "@/lib/tx";
import { useRoster } from "@/lib/use-roster";

/*
 * Commit (CLAUDE.md 5, Part 2 section 6): choose market, side and term, enter size and ask, see what is locked, the
 * premium at your ask, the effective acquisition or sale price, and the loss at three adverse prices. One
 * transaction deposits and posts the ask. Your slot on the term shows what sold, what is claimable and what can be
 * withdrawn; after expiry, settle. Disclosure: capital is locked until expiry or exercise; this is paid risk.
 */
export default function UnderwritePage() {
  return (
    <Suspense fallback={<Loading what="terms" />}>
      <UnderwriteInner />
    </Suspense>
  );
}

function UnderwriteInner() {
  const params = useSearchParams();
  const { data, error, reload } = useRoster(params.get("m"));
  const cluster = useCluster();
  const { publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const tx = useTransaction();
  const [side, setSide] = useState<Side>("put");
  const [termId, setTermId] = useState<string | null>(null);
  const [size, setSize] = useState(20);
  const [ask, setAsk] = useState<number | null>(null);

  if (error) return <ErrorState message={`Could not read the terms: ${error}`} next="Reload the page." />;
  if (!data) return <Loading what="terms" />;
  const terms = data.terms.filter((t) => t.side === side && !t.halted);
  const t = terms.find((x) => x.id === termId) ?? terms[0];
  const u = data.underlying;
  const market = data.markets.find((m) => m.symbol === u.symbol);
  if (!t || !market) return <ErrorState message="No live terms to underwrite on this market." next="Pick another market from the terms page." />;
  const myAsk = ask ?? (t.ask || 0.5);
  const m = commitMath(side, t.strike, myAsk, size);
  const sym = u.symbol;
  const adverse = side === "put" ? [t.strike * 0.95, t.strike * 0.9, t.strike * 0.8] : [t.strike * 1.05, t.strike * 1.1, t.strike * 1.2];
  const lossAt = (p: number) => (side === "put" ? Math.max(0, t.strike - p) * size : Math.max(0, p - t.strike) * size) - m.premium;
  const me = publicKey?.toBase58();
  const mine = me ? t.slots.find((s) => s.account === me) : undefined;
  const myAsks = mine ? t.asks.filter((a) => a.writerSlot === mine.slot) : [];
  const free = mine ? Math.round((mine.deposited - mine.withdrawn - mine.open - mine.assigned - myAsks.reduce((a, x) => a + sharesOf(x.remainingLots6, u.multiplier), 0)) * 1e4) / 1e4 : 0;
  const busy = tx.state.status === "building" || tx.state.status === "signing" || tx.state.status === "sending";
  const expired = t.expiryTs <= data.nowTs;
  const putsBlocked = side === "put" && market.hasTransferFee;

  async function run(kind: "quote" | "cancel_ask" | "withdraw_unsold" | "claim_premium" | "settle_writer", p?: Record<string, string | number | null>) {
    if (!t?.series || !u.mint) return;
    const sig = await tx.run({ kind, mint: u.mint, series: t.series, params: p });
    if (sig) reload(true);
  }
  function quote() {
    const lots6 = lots6ForShares(size, u.multiplier);
    const have = lots6ForShares(Math.max(0, free), u.multiplier);
    const deposit = have >= lots6 ? 0n : lots6 - have;
    // Ask per lot in USDC micro: per share x multiplier.
    const askPerLot = BigInt(Math.round(myAsk * u.multiplier * 1e6));
    void run("quote", { depositLots6: deposit.toString(), askLots6: lots6.toString(), askPerLot: askPerLot.toString() });
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="h3">Underwrite</h1>
          <p className="body-sm">Get paid to take the other side on {sym}. Lock the collateral, publish an ask, collect the premium when it fills.</p>
        </div>
        <Badge>{sym} · {market.name}</Badge>
      </div>
      <div className="grid-2" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.4fr)" }}>
        <div className="card pad">
          <Tabs value={side} onChange={(v) => { setSide(v as Side); setTermId(null); setAsk(null); tx.reset(); }} items={[{ id: "put", label: "Write Floors · get paid to buy lower" }, { id: "call", label: "Write Gaps · get paid to sell higher" }]} />
          <label className="lbl" style={{ marginTop: 16 }}>Term</label>
          <select className="field" value={t.id} onChange={(e) => { setTermId(e.target.value); setAsk(null); tx.reset(); }} aria-label="Term" data-testid="term">
            {terms.map((x) => <option key={x.id} value={x.id}>${usdK(x.strike)} through {dayLabel(x.expiryTs)} · {x.ask ? `best ask $${usd(x.ask)}` : "no ask yet"}</option>)}
          </select>
          <div className="grid-2" style={{ marginTop: 12 }}>
            <div>
              <label className="lbl">Size in {sym}</label>
              <input className="field mono" type="number" min={1} step={1} value={size} onChange={(e) => setSize(Math.max(1, Math.floor(Number(e.target.value) || DEFAULT_SIZE)))} aria-label="Size" data-testid="write-size" />
            </div>
            <div>
              <label className="lbl">Your ask per share</label>
              <input className="field mono" type="number" min={0.01} step={0.05} value={myAsk} onChange={(e) => setAsk(Math.max(0.01, Number(e.target.value) || 0.01))} aria-label="Ask per share" data-testid="write-ask" />
            </div>
          </div>
          <div className="divider" style={{ margin: "16px 0" }} />
          <KV items={[
            { k: side === "put" ? "USDC to lock" : `${sym} to lock`, v: <span className="mono ink" style={{ fontWeight: 500 }}>{side === "put" ? `$${usd0(m.locked)}` : `${m.locked} ${sym}`}</span> },
            { k: "Premium you receive", v: <span className="mono up">${usdSmart(m.premium)}</span> },
            { k: side === "put" ? "Effective buy price if assigned" : "Effective sale price if assigned", v: <span className="mono">${usd(m.effective)}</span> },
            { k: "Locked until", v: `${dayLabel(t.expiryTs)} or exercise` },
            ...(mine && free > 0 ? [{ k: "Already free in your slot", v: <span className="mono">{free} {sym}</span> }] : [])
          ]} />
          <div className="divider" style={{ margin: "16px 0" }} />
          {!publicKey ? (
            <button className="btn primary wide" onClick={() => setVisible(true)}>Connect wallet to quote</button>
          ) : (
            <button className="btn primary wide" disabled={!cluster.programDeployed || busy || expired || putsBlocked || !t.series} onClick={quote} data-testid="write">Lock {side === "put" ? `$${usd0(Math.max(0, m.locked - (side === "put" ? free * t.strike : 0)))}` : `${Math.max(0, m.locked - free)} ${sym}`} and quote</button>
          )}
          {publicKey && !cluster.programDeployed ? <div className="msg red" style={{ marginTop: 10 }} role="alert">Program not deployed on {cluster.label}; nothing to sign yet.</div> : null}
          {putsBlocked ? <div className="msg" style={{ marginTop: 10 }} role="status">This mint charges a transfer fee, so Floors are not listed on it until fee-inclusive settlement ships with First Print. Gaps are open.</div> : null}
          <TxStatus state={tx.state} onRetry={() => { tx.reset(); reload(true); }} doneHref={`/roster?m=${sym}`} doneLabel="See it on the roster" />
          <p className="note" style={{ marginTop: 12 }}>Capital is locked until expiry or exercise. This is paid risk, not yield: if the price moves through the strike you are assigned at it. Assignment is pooled: every writer on the term is assigned in proportion to what they sold, whoever bought the contract that was exercised.</p>
        </div>
        <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
          <div className="card">
            <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--line)" }}>
              <div className="h6">Loss scenarios</div>
              <div className="small" style={{ marginTop: 4 }}>What assignment costs at three adverse prices, net of the premium you collected.</div>
            </div>
            <div className="scroll-x">
              <table className="table">
                <thead><tr><th>{sym} at expiry</th><th className="num">Assignment</th><th className="num">Premium kept</th><th className="num">Net</th></tr></thead>
                <tbody>
                  {adverse.map((p) => (
                    <tr key={p}>
                      <td><span className="mono">${usd(p)}</span> <span className="small muted">({side === "put" ? "−" : "+"}{Math.abs(((p - t.strike) / t.strike) * 100).toFixed(0)}% from strike)</span></td>
                      <td className="num">{side === "put" ? `buy ${size} at $${usdK(t.strike)}` : `sell ${size} at $${usdK(t.strike)}`}</td>
                      <td className="num up">+${usdSmart(m.premium)}</td>
                      <td className="num down">−${usdSmart(lossAt(p))}</td>
                    </tr>
                  ))}
                  <tr><td>Not assigned</td><td className="num muted">collateral released at expiry</td><td className="num up">+${usdSmart(m.premium)}</td><td className="num up">+${usdSmart(m.premium)}</td></tr>
                </tbody>
              </table>
            </div>
          </div>
          {mine ? <MySlot t={t} sym={sym} multiplier={u.multiplier} mine={mine} myAsks={myAsks} free={free} expired={expired} nowTs={data.nowTs} busy={busy} onAction={run} /> : (
            <div className="card pad">
              <div className="h6">After you quote</div>
              <p className="body-sm" style={{ margin: "6px 0 0" }}>Your ask goes live on the roster next to every other underwriter on the term. Buyers match the cheapest asks first, so a fill can be partial. Premium accrues to your slot with each fill and is yours to claim any time. At expiry, what was not assigned is released and what was is settled at the strike, in one transaction anyone can send.</p>
            </div>
          )}
        </div>
      </div>
      <p className="small" style={{ marginTop: 14 }}>{data.source}</p>
    </div>
  );
}

function MySlot({ t, sym, multiplier, mine, myAsks, free, expired, nowTs, busy, onAction }: { t: Term; sym: string; multiplier: number; mine: Term["slots"][number]; myAsks: Term["asks"]; free: number; expired: boolean; nowTs: number; busy: boolean; onAction: (kind: "cancel_ask" | "withdraw_unsold" | "claim_premium" | "settle_writer", p?: Record<string, string | number | null>) => Promise<void> }) {
  return (
    <div className="card" data-testid="my-slot">
      <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--line)" }}>
        <div className="h6">Your slot on this term</div>
        <div className="small" style={{ marginTop: 4 }}>{mine.settled ? "Settled." : expired ? "Expired: settle to release what was not assigned and receive the strike for what was." : `Live until ${dayLabel(t.expiryTs)}, in ${countdown(t.expiryTs, nowTs)}.`}</div>
      </div>
      <div style={{ padding: "12px 20px" }}>
        <KV items={[
          { k: "Deposited", v: <span className="mono">{mine.deposited} {sym} covered{t.side === "put" ? ` ($${usd0(mine.deposited * t.strike)} USDC locked)` : ""}</span> },
          { k: "Sold, still open", v: <span className="mono">{mine.open} {sym}</span> },
          { k: "Assigned", v: <span className="mono">{mine.assigned} {sym}</span> },
          { k: "Quoted, unsold", v: <span className="mono">{Math.round(myAsks.reduce((a, x) => a + sharesOf(x.remainingLots6, multiplier), 0) * 1e4) / 1e4} {sym} in {myAsks.length} ask{myAsks.length === 1 ? "" : "s"}</span> },
          { k: "Free to withdraw", v: <span className="mono">{Math.max(0, free)} {sym}</span> },
          { k: "Premium claimable", v: <span className="mono up">${usd(mine.premiumClaimable)}</span> }
        ]} />
        <div className="flex items-center gap-2 flex-wrap" style={{ marginTop: 12 }}>
          {myAsks.map((a) => <button key={a.seq} className="btn secondary sm" disabled={busy || mine.settled} onClick={() => onAction("cancel_ask", { seq: a.seq })}>Cancel ask ${usd(Number(a.askPerLot) / 1e6 / multiplier)} × {sharesOf(a.remainingLots6, multiplier)}</button>)}
          <button className="btn secondary sm" disabled={busy || mine.premiumClaimable <= 0} onClick={() => onAction("claim_premium")} data-testid="claim">Claim premium</button>
          <button className="btn secondary sm" disabled={busy || free <= 0 || mine.settled} onClick={() => onAction("withdraw_unsold", { lots6: lots6ForShares(free, multiplier).toString() })}>Withdraw {Math.max(0, free)} unsold</button>
          {expired && !mine.settled ? <button className="btn primary sm" disabled={busy} onClick={() => onAction("settle_writer")} data-testid="settle">Settle</button> : null}
        </div>
      </div>
    </div>
  );
}
