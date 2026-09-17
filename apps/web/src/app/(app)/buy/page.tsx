"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { TxStatus } from "@/components/tx-status";
import { Badge, ErrorState, KV, Loading } from "@/components/ui";
import { useCluster } from "@/lib/cluster";
import { usd, usdK, usdSmart, dayLabel } from "@/lib/format";
import { walkAsks, feeCeil } from "@/lib/model";
import { useTransaction } from "@/lib/tx";
import { useRoster } from "@/lib/use-roster";

/*
 * Protected Buy (CLAUDE.md 5): two buttons on a Tier 1 or Tier 2 market. Buy, or buy with a floor through a chosen
 * expiry. The second shows purchase cost, premium and protected proceeds together. One transaction: a Jupiter swap
 * plus a Floor on the tokens the swap can deliver at worst, then Manage.
 */
export default function BuyPage() {
  return (
    <Suspense fallback={<Loading what="the desk" />}>
      <BuyInner />
    </Suspense>
  );
}

interface SwapQuote { tokensOutRaw: string; minOutRaw: string; route: string; priceImpactPct: string; slippageBps: number }

function BuyInner() {
  const params = useSearchParams();
  const { data, error } = useRoster(params.get("m"));
  const cluster = useCluster();
  const { publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const tx = useTransaction();
  const [usdcIn, setUsdcIn] = useState(1000);
  const [floorId, setFloorId] = useState<string | null>(null);
  const [swap, setSwap] = useState<SwapQuote | null>(null);
  const [swapError, setSwapError] = useState<string | null>(null);
  const mint = data?.underlying.mint ?? null;

  useEffect(() => {
    if (!mint || usdcIn <= 0) return;
    const h = setTimeout(() => {
      setSwapError(null);
      fetch(`/api/swap-quote?mint=${mint}&usdc=${Math.round(usdcIn * 1e6)}`, { cache: "no-store" })
        .then(async (r) => { const j = (await r.json()) as SwapQuote & { error?: string }; if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`); return j; })
        .then(setSwap)
        .catch((e: unknown) => { setSwap(null); setSwapError(e instanceof Error ? e.message : String(e)); });
    }, 350);
    return () => clearTimeout(h);
  }, [mint, usdcIn]);

  if (error) return <ErrorState message={`Could not read the terms: ${error}`} next="Reload the page." />;
  if (!data) return <Loading what="the desk" />;
  const u = data.underlying;
  const market = data.markets.find((m) => m.symbol === u.symbol);
  const decimals = market?.decimals ?? 8;
  const floors = data.terms.filter((t) => t.side === "put" && t.asks.length > 0 && !t.halted);
  const f = floors.find((x) => x.id === floorId) ?? floors[0];
  const tokens = swap ? Number(swap.tokensOutRaw) / 10 ** decimals : null;
  const minTokens = swap ? Number(swap.minOutRaw) / 10 ** decimals : null;
  const shares = tokens === null ? null : tokens * u.multiplier;
  // The floor covers the swap&apos;s minimum out, at lot granularity, exactly as the builder does.
  const minLots6 = market ? BigInt(market.minLots6) : 10_000n;
  const lots6 = swap ? ((BigInt(swap.minOutRaw) * 1_000_000n) / 10n ** BigInt(decimals) / minLots6) * minLots6 : 0n;
  const w = f && lots6 > 0n ? walkAsks(f.asks, lots6) : null;
  const premium = w ? Number(w.premium) / 1e6 : null;
  const fee = w ? Number(feeCeil(w.premium, data.feeBps)) / 1e6 : null;
  const protectedAt = f && minTokens !== null ? (Number(lots6) / 1e6) * (f.strike * u.multiplier) : null;
  const busy = tx.state.status === "building" || tx.state.status === "signing" || tx.state.status === "sending";
  const ready = !!publicKey && cluster.programDeployed && !!swap && !busy && !!mint;

  async function run(withFloor: boolean) {
    if (!mint) return;
    const worst = f ? f.asks.reduce((a, x) => (BigInt(x.askPerLot) > a ? BigInt(x.askPerLot) : a), 0n) : 0n;
    await tx.run({ kind: "protected_buy", mint, series: withFloor && f?.series ? f.series : "", params: { usdcIn: String(Math.round(usdcIn * 1e6)), maxPremiumPerLot: worst.toString(), slippageBps: 50 } });
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="h3">Protected Buy</h1>
          <p className="body-sm">Buy {u.symbol}, or buy {u.symbol} with a floor through a date, in one transaction: a Jupiter swap and a Floor on what the swap delivers.</p>
        </div>
        <Badge>{u.symbol} · {u.name}</Badge>
      </div>
      <div className="card pad" style={{ marginBottom: 16 }}>
        <label className="lbl">USDC to spend</label>
        <input className="field mono" type="number" min={1} step={1} value={usdcIn} onChange={(e) => setUsdcIn(Math.max(1, Math.floor(Number(e.target.value) || 1)))} style={{ maxWidth: 240 }} aria-label="USDC to spend" data-testid="usdc-in" />
        <div className="small" style={{ marginTop: 8 }}>
          {swapError ? <span className="down">Jupiter quote unavailable: {swapError}</span> : swap && tokens !== null ? <>Jupiter quotes <b className="mono ink">{tokens.toFixed(4)} {u.symbol}</b> via {swap.route}, at least <b className="mono ink">{minTokens!.toFixed(4)}</b> after {swap.slippageBps} bps slippage{Number(swap.priceImpactPct) > 0 ? `, ${(Number(swap.priceImpactPct) * 100).toFixed(2)}% price impact` : ""}.</> : "Fetching a Jupiter quote…"}
        </div>
      </div>
      <div className="grid-2">
        <div className="card pad">
          <div className="h5">Buy</div>
          <p className="body-sm" style={{ margin: "6px 0 16px" }}>A swap into {u.symbol} through Jupiter at the current token price. No floor, no premium.</p>
          <KV items={[
            { k: "Token mark", v: <span className="mono">${usd(u.mark)}</span> },
            { k: "You receive", v: <span className="mono">{tokens === null ? "…" : `${tokens.toFixed(4)} ${u.symbol}`}</span> },
            { k: "Cost", v: <span className="mono ink" style={{ fontWeight: 500 }}>${usdSmart(usdcIn)}</span> },
            { k: "Worst case", v: "the token price" }
          ]} />
          <div className="divider" style={{ margin: "16px 0" }} />
          {!publicKey ? <button className="btn primary wide" onClick={() => setVisible(true)}>Connect wallet</button> : <button className="btn primary wide" disabled={!ready} onClick={() => run(false)} data-testid="buy-plain">Buy {tokens === null ? "" : `${tokens.toFixed(2)} `}{u.symbol}</button>}
        </div>
        <div className="card pad" style={{ boxShadow: "inset 0 2px 0 var(--ink)" }}>
          <div className="h5">Buy with a floor</div>
          <p className="body-sm" style={{ margin: "6px 0 16px" }}>The same swap, plus a Floor bought in the same transaction on the tokens it delivers. Purchase cost, premium and protected proceeds, together.</p>
          <label className="lbl">Floor</label>
          <select className="field" value={f?.id ?? ""} onChange={(e) => setFloorId(e.target.value)} aria-label="Floor" data-testid="floor">
            {floors.length === 0 ? <option value="">No Floor quoted on {u.symbol} right now</option> : floors.map((x) => <option key={x.id} value={x.id}>${usdK(x.strike)} through {dayLabel(x.expiryTs)} · ${usd(x.ask)} per share</option>)}
          </select>
          <div style={{ marginTop: 14 }}>
            <KV items={[
              { k: `Purchase, ${shares === null ? "…" : shares.toFixed(2)} ${u.symbol}`, v: <span className="mono">${usdSmart(usdcIn)}</span> },
              { k: `Premium${fee !== null ? ` and ${data.feeBps} bps fee` : ""}`, v: <span className="mono">{premium === null ? "…" : w && !w.fillable ? "not fillable at this size" : `$${usdSmart(premium + (fee ?? 0))}`}</span> },
              { k: "Total", v: <span className="mono ink" style={{ fontWeight: 500 }} data-testid="pb-total">{premium === null ? "…" : `$${usdSmart(usdcIn + premium + (fee ?? 0))}`}</span> },
              { k: `Protected proceeds through ${f ? dayLabel(f.expiryTs) : "expiry"}`, v: <span className="mono up">{protectedAt === null ? "…" : `$${usdSmart(protectedAt)}`}</span> },
              { k: "Worst case", v: <span className="mono down">{protectedAt === null || premium === null ? "…" : `−$${usdSmart(usdcIn + premium + (fee ?? 0) - protectedAt)}`}</span> }
            ]} />
          </div>
          <div className="divider" style={{ margin: "16px 0" }} />
          {!publicKey ? <button className="btn primary wide" onClick={() => setVisible(true)}>Connect wallet</button> : <button className="btn primary wide" disabled={!ready || !f || !w?.fillable} onClick={() => run(true)} data-testid="buy-floor">Buy {u.symbol} with a ${f ? usdK(f.strike) : "–"} floor</button>}
        </div>
      </div>
      {publicKey && !cluster.programDeployed ? <div className="msg red" style={{ marginTop: 12 }} role="alert">Program not deployed on {cluster.label}; nothing to sign yet.</div> : null}
      <TxStatus state={tx.state} onRetry={tx.reset} doneHref="/positions" doneLabel="See it under Positions" />
      <p className="note" style={{ marginTop: 12 }}>Contracts can expire worthless. Maximum loss on the floor is its premium plus fees; the floor pays only if exercised. The token price itself is not protected below the strike minus the premium. The floor covers the swap&apos;s minimum out, so a slippage shortfall never leaves tokens uncovered.</p>
      <p className="small" style={{ marginTop: 14 }}>{data.source}</p>
    </div>
  );
}
