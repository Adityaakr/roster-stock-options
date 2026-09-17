"use client";

import Link from "next/link";
import { use, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { PayoffChart } from "@/components/payoff-chart";
import { Slider } from "@/components/landing/examples";
import { TxStatus } from "@/components/tx-status";
import { Address, Badge, ErrorState, KV, Loading } from "@/components/ui";
import { useCluster, explorerUrl } from "@/lib/cluster";
import { usd, usdK, usdSmart, dayLabel, countdown } from "@/lib/format";
import { breakEven, costOf, DEFAULT_SIZE, maxLoss, moveNeeded, parseTermId, productName } from "@/lib/model";
import { useTransaction } from "@/lib/tx";
import { useRoster } from "@/lib/use-roster";

/*
 * Act (CLAUDE.md 5, Part 2 section 6): the payoff slider with max loss pinned, the executable quote at the chosen size
 * with the fee, the split and the referrer disclosure, the escrow that backs the fill with its accounts, one
 * transaction to sign, the confirmation with its signature, and a failure taxonomy each with a next action.
 */
export default function ActPage({ params }: { params: Promise<{ term: string }> }) {
  const { term: id } = use(params);
  const parsed = parseTermId(id);
  const { data, error, reload } = useRoster(parsed?.symbol ?? null);
  const cluster = useCluster();
  const { publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const tx = useTransaction();
  const [size, setSize] = useState(DEFAULT_SIZE);
  const [expected, setExpected] = useState<number | null>(null);

  if (error) return <ErrorState message={`Could not read the term: ${error}`} next="Reload the page." />;
  if (!data) return <Loading what="the term" />;
  const t = data.terms.find((x) => x.id === id);
  if (!t) return <ErrorState message="This term is not live." next={<Link className="link" href="/trade">Back to the terms</Link>} />;

  const u = data.underlying;
  const market = data.markets.find((m) => m.symbol === u.symbol);
  const c = costOf(t, size, u.multiplier, data.feeBps);
  const ask = c.fillable ? c.premium / size : null;
  const be = ask === null ? null : breakEven(t.side, t.strike, ask);
  const mv = ask === null ? null : moveNeeded(t.side, t.strike, ask, u.mark);
  const ex = expected ?? Math.round(u.mark * (t.side === "call" ? 1.08 : 0.92));
  const name = productName(t.side);
  const live = t.writers.filter((w) => w.live);
  const sizeCap = market ? Math.floor(t.capacity) : 0;
  const canSign = !!publicKey && cluster.programDeployed && c.fillable && !t.halted && !market?.paused && tx.state.status !== "building" && tx.state.status !== "signing" && tx.state.status !== "sending";

  async function buy() {
    if (!t?.series || !u.mint) return;
    const sig = await tx.run({ kind: "buy", mint: u.mint, series: t.series, params: { lots6: c.lots6.toString(), maxPremiumPerLot: c.maxPremiumPerLot.toString(), referrer: null } });
    if (sig) reload(true);
  }

  return (
    <div>
      <div className="small" style={{ marginBottom: 14 }}><Link className="muted" href="/trade">Terms</Link> <span className="muted">/</span> <Link className="muted" href={`/trade?m=${u.symbol}`}>{u.symbol}</Link> <span className="muted">/</span> {name} ${usdK(t.strike)} · {dayLabel(t.expiryTs)}</div>
      <div className="page-head">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="h3">{name} at ${usdK(t.strike)} through {dayLabel(t.expiryTs)}</h1>
            <Badge dot tone={t.halted ? "amber" : c.fillable ? "green" : "amber"}>{t.halted ? "halted" : c.fillable ? "executable" : "not fillable at this size"}</Badge>
            <Badge>{u.wrapperTier}</Badge>
          </div>
          <p className="body-sm">{t.side === "call" ? `The right to buy ${u.symbol} at $${usdK(t.strike)} per share, any time until expiry.` : `The right to sell ${u.symbol} at $${usdK(t.strike)} per share, any time until expiry.`} Expires in {countdown(t.expiryTs, data.nowTs)}. {Math.floor(t.capacity)} {u.symbol} fillable now across {live.length} underwriter{live.length === 1 ? "" : "s"}.</p>
        </div>
      </div>

      <div className="grid-2" style={{ gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 1fr)" }}>
        <div className="card">
          <div className="flex items-center justify-between gap-3 flex-wrap" style={{ padding: "16px 20px", borderBottom: "1px solid var(--line)" }}>
            <div>
              <div className="h6">Payoff at expiry for {size} {u.symbol}</div>
              <div className="small" style={{ marginTop: 4 }}>Drag the expected price. Profit, break-even and max loss update; max loss stays where it is.</div>
            </div>
            <span className="small">Mark <b className="mono ink">${usd(u.mark)}</b></span>
          </div>
          <div style={{ padding: "16px 12px 8px" }}>
            <PayoffChart side={t.side} strike={t.strike} premium={ask ?? t.ask} shares={size} mark={u.mark} expected={ex} />
            <Slider value={ex} min={Math.round(u.mark * 0.8)} max={Math.round(u.mark * 1.2)} onChange={setExpected} label="Expected price at expiry" />
          </div>
          <div style={{ padding: "0 20px 20px" }}>
            <div className="grid-3">
              <div className="inset" style={{ padding: 12 }}><div className="small">Break-even</div><div className="h4 num">{be === null ? "n/a" : `$${usd(be)}`}</div></div>
              <div className="inset" style={{ padding: 12 }}><div className="small">Move needed</div><div className={`h4 num ${mv !== null && mv <= 0 ? "up" : ""}`}>{mv === null ? "n/a" : `${mv >= 0 ? "+" : "−"}${Math.abs(mv).toFixed(1)}%`}</div></div>
              <div className="inset" style={{ padding: 12 }}><div className="small">Maximum loss</div><div className="h4 num down">{ask === null ? "n/a" : `−$${usdSmart(maxLoss(ask, size, data.feeBps))}`}</div></div>
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
          <div className="card pad">
            <div className="h6">The quote</div>
            <label className="lbl" style={{ marginTop: 12 }}>Size in {u.symbol}</label>
            <input className="field mono" type="number" min={1} max={Math.max(1, sizeCap)} step={1} value={size} onChange={(e) => setSize(Math.max(1, Math.floor(Number(e.target.value) || 1)))} aria-label="Size" data-testid="size" />
            <div style={{ marginTop: 14 }}>
              <KV items={[
                { k: "Premium per share", v: <span className="mono">{ask === null ? "not fillable" : `$${usd(ask)}`}</span> },
                { k: `Premium for ${size}`, v: <span className="mono">{c.fillable ? `$${usdSmart(c.premium)}` : "n/a"}</span> },
                { k: `Fee, ${data.feeBps} bps`, v: <span className="mono">{c.fillable ? `$${usd(c.fee)}` : "n/a"}</span> },
                { k: "Total", v: <span className="mono ink" style={{ fontWeight: 500 }} data-testid="total">{c.fillable ? `$${usdSmart(c.total)}` : "n/a"}</span> },
                { k: "Split across", v: c.fillable ? `${c.writers} underwriter${c.writers > 1 ? "s" : ""}` : `${Math.floor(t.capacity)} ${u.symbol} available` },
                { k: "Referrer", v: "none" }
              ]} />
            </div>
            <p className="note" style={{ marginTop: 8 }}>No referrer on this buy: the integrator share of the fee stays with the protocol.</p>
            <div className="divider" style={{ margin: "16px 0" }} />
            <div className="small">Escrow backing this fill</div>
            <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
              {t.escrow ? (
                <>
                  <div className="flex items-center justify-between gap-3 small"><span>Collateral vault</span><Address value={t.escrow.collateralVault} href={explorerUrl(cluster, "address", t.escrow.collateralVault)} /></div>
                  <div className="flex items-center justify-between gap-3 small"><span>Settlement vault</span><Address value={t.escrow.settlementVault} href={explorerUrl(cluster, "address", t.escrow.settlementVault)} /></div>
                  <div className="flex items-center justify-between gap-3 small"><span>Series</span><Address value={t.series ?? ""} href={t.series ? explorerUrl(cluster, "address", t.series) : null} /></div>
                  {live.map((w) => <div key={w.account} className="flex items-center justify-between gap-3 small"><span>Underwriter · {w.askLots} lots quoted</span><Address value={w.account} href={explorerUrl(cluster, "address", w.account)} /></div>)}
                </>
              ) : <div className="small muted">Accounts appear once the program is deployed; none are invented.</div>}
            </div>
            <div className="divider" style={{ margin: "16px 0" }} />
            {!publicKey ? (
              <button className="btn primary wide" onClick={() => setVisible(true)}>Connect wallet to buy</button>
            ) : (
              <button className="btn primary wide" disabled={!canSign} onClick={buy} data-testid="buy">Buy {size} {u.symbol} {name}{c.fillable ? ` for $${usdSmart(c.total)}` : ""}</button>
            )}
            {publicKey && !cluster.programDeployed ? (
              <div className="msg red" style={{ marginTop: 10 }} role="alert">The program is not deployed on the {cluster.label} cluster, so nothing can be signed yet. The quote above is what the button will send once it is.</div>
            ) : null}
            {publicKey && cluster.programDeployed && !c.fillable ? <div className="msg" style={{ marginTop: 10 }} role="status">Not fillable at {size}. {Math.floor(t.capacity)} {u.symbol} is quoted on this term right now; lower the size or wait for the roster to refresh.</div> : null}
            <TxStatus state={tx.state} onRetry={() => { tx.reset(); reload(true); }} doneHref="/positions" doneLabel="See it under Positions" />
            <p className="note" style={{ marginTop: 12 }}>Contracts can expire worthless. Maximum loss is the premium plus fees. {t.side === "call" ? "Exercising requires paying the strike in USDC." : "Exercising requires delivering the tokens."} One transaction; the wallet signs, the app submits.</p>
            {market && market.feeBps > 0 ? <div className="msg" role="status" style={{ marginTop: 10 }} data-testid="fee-note">This mint charges a {(market.feeBps / 100).toFixed(2)}% transfer fee. On exercise you pay the full strike and receive {size} {u.symbol} less that fee, about {(size * (1 - market.feeBps / 10_000)).toFixed(4)} {u.symbol}. Floors are not listed on it until fee-inclusive settlement ships.</div> : null}
          </div>
          <div className="card pad">
            <div className="h6">What happens next</div>
            <p className="body-sm" style={{ margin: "6px 0 0" }}>The position token lands in your wallet and appears under Positions with its mark, its countdown and exactly what exercising requires: {t.side === "call" ? `pay $${usdSmart(t.strike * size)} USDC, receive ${size} ${u.symbol}` : `deliver ${size} ${u.symbol}, receive $${usdSmart(t.strike * size)} USDC`}. A fill can be partial when the quoted size is not all there any more; you pay only for what filled.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
