"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useConnect } from "@/lib/connect";
import { TxStatus } from "@/components/tx-status";
import { MarketLogo } from "@/components/market-list";
import { Badge, ErrorState, KV, Loading, Tabs } from "@/components/ui";
import { useCluster } from "@/lib/cluster";
import { usd, usdK, usdSmart, dayLabel } from "@/lib/format";
import { walkAsks, feeCeil, lots6ForShares } from "@/lib/model";
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
  const router = useRouter();
  const { data, error } = useRoster(params.get("m"));
  const cluster = useCluster();
  const { publicKey } = useWallet();
  const connect = useConnect();
  const tx = useTransaction();
  const reduce = useReducedMotion();
  const [usdcIn, setUsdcIn] = useState(1000);
  const [floorId, setFloorId] = useState<string | null>(null);
  const [mode, setMode] = useState<"floor" | "plain">("floor");
  const [swap, setSwap] = useState<SwapQuote | null>(null);
  const [swapError, setSwapError] = useState<string | null>(null);
  const mint = data?.underlying.mint ?? null;

  // A swap needs a market to route through, and a devnet replica has none: nothing is fetched there, and the desk
  // says so rather than showing a failed request. The floor on its own is still one click away.
  const noRoute = cluster.cluster === "devnet";

  useEffect(() => {
    if (!mint || usdcIn <= 0 || noRoute) return;
    const h = setTimeout(() => {
      setSwapError(null);
      fetch(`/api/swap-quote?mint=${mint}&usdc=${Math.round(usdcIn * 1e6)}`, { cache: "no-store" })
        .then(async (r) => { const j = (await r.json()) as SwapQuote & { error?: string }; if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`); return j; })
        .then(setSwap)
        .catch((e: unknown) => { setSwap(null); setSwapError(e instanceof Error ? e.message : String(e)); });
    }, 350);
    return () => clearTimeout(h);
  }, [mint, usdcIn, noRoute]);

  if (error) return <ErrorState message={`Could not read the terms: ${error}`} next="Reload the page." />;
  if (!data) return <Loading what="the desk" />;
  const u = data.underlying;
  const market = data.markets.find((m) => m.symbol === u.symbol);
  const decimals = market?.decimals ?? 8;
  // Only Floors with a resident ask that can actually fill: a series whose asks are all spent is not a floor to buy.
  const floors = data.terms.filter((t) => t.side === "put" && !t.halted && t.capacity > 0 && t.ladder[0]?.ask !== null);
  const f = floors.find((x) => x.id === floorId) ?? floors[0];
  const tokens = swap ? Number(swap.tokensOutRaw) / 10 ** decimals : null;
  const minTokens = swap ? Number(swap.minOutRaw) / 10 ** decimals : null;
  const shares = tokens === null ? null : tokens * u.multiplier;
  // The floor covers the swap&apos;s minimum out, at lot granularity, exactly as the builder does.
  const minLots6 = market ? BigInt(market.minLots6) : 10_000n;
  // Without a swap quote (no route on this cluster, or one still loading) the floor is sized at the mark, and every
  // figure that depends on it is marked as an estimate.
  const lots6 = swap ? ((BigInt(swap.minOutRaw) * 1_000_000n) / 10n ** BigInt(decimals) / minLots6) * minLots6 : u.mark > 0 ? (lots6ForShares(usdcIn / u.mark, u.multiplier) / minLots6) * minLots6 : 0n;
  const w = f && lots6 > 0n ? walkAsks(f.asks, lots6) : null;
  // A walk that cannot fill the whole size yields no price: every figure that depends on it waits rather than misleads.
  const premium = w && w.fillable ? Number(w.premium) / 1e6 : null;
  const fee = w && w.fillable ? Number(feeCeil(w.premium, data.feeBps)) / 1e6 : null;
  const unfillable = !!w && !w.fillable;
  const protectedAt = f && lots6 > 0n ? (Number(lots6) / 1e6) * (f.strike * u.multiplier) : null;
  const busy = tx.state.status === "building" || tx.state.status === "signing" || tx.state.status === "sending";
  const ready = !!publicKey && cluster.programDeployed && !!swap && !busy && !!mint;

  async function run(withFloor: boolean) {
    if (!mint) return;
    const worst = f ? f.asks.reduce((a, x) => (BigInt(x.askPerLot) > a ? BigInt(x.askPerLot) : a), 0n) : 0n;
    await tx.run({ kind: "protected_buy", mint, series: withFloor && f?.series ? f.series : "", params: { usdcIn: String(Math.round(usdcIn * 1e6)), maxPremiumPerLot: worst.toString(), slippageBps: 50 } });
  }

  // The sketch: what the purchase is worth at expiry across a band of prices, with and without the floor. Shares
  // come from the swap quote when there is one, else from the mark, and the panel says which.
  const estShares = shares ?? usdcIn / Math.max(1e-9, u.mark);
  const estimated = shares === null;
  const floorShares = f && lots6 > 0n ? (Number(lots6) / 1e6) * u.multiplier : estShares;
  const cost = premium ?? (f ? f.ask * floorShares : 0);
  const valueAt = (p: number, withFloor: boolean) => withFloor && f ? Math.max(f.strike * floorShares, p * estShares) - cost - (fee ?? 0) : p * estShares;
  const band = [0.75, 0.85, 0.95, 1, 1.05, 1.15, 1.25].map((k) => u.mark * k);
  const W = 420, H = 180, PAD = 8;
  const ys = band.flatMap((p) => [valueAt(p, false), valueAt(p, true)]);
  const yMin = Math.min(...ys), yMax = Math.max(...ys);
  const X = (p: number) => PAD + ((p - band[0]!) / (band[band.length - 1]! - band[0]!)) * (W - 2 * PAD);
  const Y = (v: number) => H - PAD - ((v - yMin) / Math.max(1e-9, yMax - yMin)) * (H - 2 * PAD);
  const path = (withFloor: boolean) => band.map((p, i) => `${i ? "L" : "M"}${X(p).toFixed(1)},${Y(valueAt(p, withFloor)).toFixed(1)}`).join(" ");
  const scen = [-0.25, -0.1, 0, 0.1, 0.25].map((d) => ({ d, p: u.mark * (1 + d), plain: valueAt(u.mark * (1 + d), false) - usdcIn, floor: valueAt(u.mark * (1 + d), true) - usdcIn }));

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="flex items-center gap-2"><h1 style={{ margin: 0 }}>Protected Buy</h1>{noRoute ? <Badge tone="amber">coming soon on this cluster</Badge> : null}</div>
          <p>Buy the token, or buy it with a floor through a date, in one transaction: a Jupiter swap and a Floor on what the swap delivers. The floor is bought before the tokens land, so nothing is ever uncovered.{noRoute ? " A replica token has no swap route, so the swap leg needs mainnet; the floor below is priced live and the ticket shows what the transaction will do." : ""}</p>
        </div>
        <div className="flex items-center gap-3">
          {market ? <MarketLogo m={market} size={36} /> : null}
          <div><div style={{ fontWeight: 500 }}>{u.symbol} <span className="muted" style={{ fontWeight: 400 }}>{u.name}</span></div><div className="small muted">mark <span className="mono ink">${usd(u.mark)}</span></div></div>
        </div>
      </div>

      <div className="uexplore pb-markets" style={{ marginTop: 18 }}>
        {data.markets.filter((m) => m.tier <= 2).sort((a, b) => a.tier - b.tier || b.depthUsdc - a.depthUsdc).map((m) => (
          <button key={m.symbol} className={`utile ${m.symbol === u.symbol ? "on" : ""}`} onClick={() => router.replace(`/buy?m=${m.symbol}`)}>
            <span className="t flex items-center gap-2"><MarketLogo m={m} size={18} />{m.symbol}</span>
            <span className="s">${usd(m.mark ?? 0)} · {data.ideas.filter((i) => i.market === m.symbol && i.side === "put").length ? "floor" : "no floor"}</span>
          </button>
        ))}
      </div>

      <div className="grid-2 split-right" style={{ marginTop: 22 }}>
        <div className="card pad pb-ticket">
          <label className="lbl">USDC to spend</label>
          <div className="pb-amount">
            <input className="field mono" type="number" min={1} step={1} value={usdcIn} onChange={(e) => setUsdcIn(Math.max(1, Math.floor(Number(e.target.value) || 1)))} aria-label="USDC to spend" data-testid="usdc-in" />
            <span className="unit">USDC</span>
          </div>
          <div className="flex items-center gap-2" style={{ marginTop: 8 }}>
            {[250, 1000, 5000].map((n) => <button key={n} className={`chip ${usdcIn === n ? "on" : ""}`} onClick={() => setUsdcIn(n)}>${usdK(n)}</button>)}
          </div>
          <div className="small" style={{ marginTop: 10 }}>
            {noRoute ? <span className="muted">No swap route for this token on this cluster: the swap leg trades on mainnet. The floor is live and priced below.</span> : swapError ? <span className="down">Jupiter quote unavailable: {swapError}</span> : swap && tokens !== null ? <>Jupiter quotes <b className="mono ink">{tokens.toFixed(4)} {u.symbol}</b> via {swap.route}, at least <b className="mono ink">{minTokens!.toFixed(4)}</b> after {swap.slippageBps} bps slippage{Number(swap.priceImpactPct) > 0 ? `, ${(Number(swap.priceImpactPct) * 100).toFixed(2)}% price impact` : ""}.</> : "Fetching a Jupiter quote…"}
          </div>

          <div className="divider" style={{ margin: "18px 0" }} />
          <label className="lbl">Protection</label>
          <Tabs value={mode} onChange={setMode} items={[{ id: "floor", label: "With a floor" }, { id: "plain", label: "No floor" }]} />
          {mode === "floor" ? (
            <>
              <p className="small muted" style={{ margin: "10px 0 12px" }}>A Floor bought in the same transaction on the tokens the swap delivers: the right to sell them at the strike any time through the date.</p>
              <label className="lbl">Floor</label>
              <select className="field" value={f?.id ?? ""} onChange={(e) => setFloorId(e.target.value)} aria-label="Floor" data-testid="floor">
                {floors.length === 0 ? <option value="">No Floor quoted on {u.symbol} right now</option> : floors.map((x) => <option key={x.id} value={x.id}>${usdK(x.strike)} through {dayLabel(x.expiryTs)} · ${usd(x.ask)} per share</option>)}
              </select>
              <div className="intent-figs pb-figs" style={{ marginTop: 14 }}>
                <div><span>You get</span><b className="mono">{shares === null ? `~${estShares.toFixed(2)}` : shares.toFixed(2)} {u.symbol}</b><i className="small muted">{estimated ? "at the mark" : "from the swap"}</i></div>
                <div><span>Total</span><b className="mono" data-testid="pb-total">{premium === null ? "…" : `$${usdSmart(usdcIn + premium + (fee ?? 0))}`}</b><i className="small muted">purchase plus the floor</i></div>
                <div><span>Floor pays at least</span><b className="mono up">{protectedAt === null ? "…" : `$${usdSmart(protectedAt)}`}</b><i className="small muted">through {f ? dayLabel(f.expiryTs) : "expiry"}</i></div>
                <div><span>Worst case</span><b className="mono down">{protectedAt === null || premium === null ? "…" : `−$${usdSmart(usdcIn + premium + (fee ?? 0) - protectedAt)}`}</b><i className="small muted">{protectedAt !== null && premium !== null ? `${(((usdcIn + premium + (fee ?? 0) - protectedAt) / usdcIn) * 100).toFixed(1)}% of what you spend` : ""}</i></div>
              </div>
              <div style={{ marginTop: 14 }}>
                <KV items={[
                  { k: `Purchase, ${shares === null ? `about ${estShares.toFixed(2)}` : shares.toFixed(2)} ${u.symbol}`, v: <span className="mono">${usdSmart(usdcIn)}</span> },
                  { k: `Premium${fee !== null ? ` and ${data.feeBps} bps fee` : ""}`, v: <span className="mono">{unfillable ? "not fillable at this size" : premium === null ? "…" : `$${usdSmart(premium + (fee ?? 0))}`}</span> },
                  { k: "Total", v: <span className="mono ink" style={{ fontWeight: 500 }}>{premium === null ? "…" : `$${usdSmart(usdcIn + premium + (fee ?? 0))}`}</span> },
                  { k: `Protected proceeds through ${f ? dayLabel(f.expiryTs) : "expiry"}`, v: <span className="mono up">{protectedAt === null ? "…" : `$${usdSmart(protectedAt)}`}</span> },
                  { k: "Worst case", v: <span className="mono down">{protectedAt === null || premium === null ? "…" : `−$${usdSmart(usdcIn + premium + (fee ?? 0) - protectedAt)}`}</span> }
                ]} />
              </div>
              {estimated && premium !== null ? <p className="small muted" style={{ margin: "8px 0 0" }}>Sized at the mark until a swap quote arrives; the transaction sizes the floor to the swap&apos;s minimum out.</p> : null}
              <div className="divider" style={{ margin: "16px 0" }} />
              {!publicKey ? <button className="btn primary wide" onClick={() => connect()}>Connect wallet</button> : <button className="btn primary wide" disabled={!ready || !f || !w?.fillable} onClick={() => run(true)} data-testid="buy-floor">Buy {u.symbol} with a ${f ? usdK(f.strike) : "–"} floor</button>}
            </>
          ) : (
            <>
              <p className="small muted" style={{ margin: "10px 0 12px" }}>A swap into {u.symbol} through Jupiter at the current token price. No floor, no premium.</p>
              <KV items={[
                { k: "Token mark", v: <span className="mono">${usd(u.mark)}</span> },
                { k: "You receive", v: <span className="mono">{tokens === null ? "…" : `${tokens.toFixed(4)} ${u.symbol}`}</span> },
                { k: "Cost", v: <span className="mono ink" style={{ fontWeight: 500 }}>${usdSmart(usdcIn)}</span> },
                { k: "Worst case", v: "the token price" }
              ]} />
              <div className="divider" style={{ margin: "16px 0" }} />
              {!publicKey ? <button className="btn primary wide" onClick={() => connect()}>Connect wallet</button> : <button className="btn primary wide" disabled={!ready} onClick={() => run(false)} data-testid="buy-plain">Buy {tokens === null ? "" : `${tokens.toFixed(2)} `}{u.symbol}</button>}
            </>
          )}
        </div>

        <div className="card">
          <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--line)" }}>
            <div className="h6">What it is worth at expiry</div>
            <div className="small muted" style={{ marginTop: 4 }}>The value of ${usdSmart(usdcIn)} of {u.symbol} across a band of prices, with and without the ${f ? usdK(f.strike) : "–"} floor{estimated ? ", shares estimated at the mark" : ""}.</div>
          </div>
          <div style={{ padding: "16px 20px" }}>
            {u.mark <= 0 ? <div className="small muted">Waiting for a mark.</div> : <svg viewBox={`0 0 ${W} ${H}`} className="pb-sketch" role="img" aria-label="Value at expiry with and without the floor">
              {f && f.strike > band[0]! ? <rect x={X(band[0]!)} y={PAD} width={X(f.strike) - X(band[0]!)} height={H - 2 * PAD} fill="var(--surface)" /> : null}
              <line x1={PAD} x2={W - PAD} y1={Y(usdcIn)} y2={Y(usdcIn)} stroke="var(--line)" />
              <text x={W - PAD} y={Y(usdcIn) - 4} textAnchor="end" className="pb-lbl">what you spend</text>
              <line x1={X(u.mark)} x2={X(u.mark)} y1={PAD} y2={H - PAD} stroke="var(--line)" strokeDasharray="3 3" />
              <text x={X(u.mark) + 4} y={H - PAD - 4} className="pb-lbl">mark ${usdK(u.mark)}</text>
              {f ? <><line x1={X(f.strike)} x2={X(f.strike)} y1={PAD} y2={H - PAD} stroke="var(--ink)" strokeDasharray="3 3" /><text x={X(f.strike) - 4} y={PAD + 10} textAnchor="end" className="pb-lbl ink">floor ${usdK(f.strike)}</text></> : null}
              <path d={path(false)} fill="none" stroke="var(--slate)" strokeWidth="1.5" />
              {f ? <motion.path key={`${f.id}-${usdcIn}`} d={path(true)} fill="none" stroke="var(--ink)" strokeWidth="2" initial={reduce ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.9, ease: [0.2, 0, 0, 1] }} /> : null}
              {f && protectedAt !== null ? <text x={X(band[0]!) + 4} y={Y(valueAt(band[0]!, true)) + 13} className="pb-lbl ink">floor pays ${usdK(protectedAt)}, whatever happens below</text> : null}
            </svg>}
            <div className="flex items-center justify-between small muted mono" style={{ marginTop: 4 }}><span>${usdK(band[0]!)} <span className="sans">(−25%)</span></span><span>{u.symbol} at expiry</span><span><span className="sans">(+25%)</span> ${usdK(band[band.length - 1]!)}</span></div>
            <div className="flex items-center gap-4 small" style={{ marginTop: 10 }}><span className="flex items-center gap-2"><i className="pb-key" style={{ background: "var(--ink)" }} />With the floor</span><span className="flex items-center gap-2"><i className="pb-key" style={{ background: "var(--slate)" }} />Without</span><span className="flex items-center gap-2"><i className="pb-key" style={{ background: "var(--surface)", height: 10, border: "1px solid var(--line)" }} />Below the floor</span></div>
          </div>
          <table className="table">
            <thead><tr><th>{u.symbol} at expiry</th><th className="num">Without</th><th className="num">With the floor</th><th className="hide-sm">Which means</th></tr></thead>
            <tbody>
              {scen.map((r) => (
                <tr key={r.d}>
                  <td className="nowrap"><span className="mono">${usd(r.p)}</span> <span className="small muted">({r.d === 0 ? "mark" : `${r.d > 0 ? "+" : "−"}${Math.abs(r.d * 100).toFixed(0)}%`})</span></td>
                  <td className={`num mono ${r.plain < 0 ? "down" : r.plain > 0 ? "up" : ""}`}>{r.plain === 0 ? "0" : `${r.plain < 0 ? "−" : "+"}$${usdSmart(Math.abs(r.plain))}`}</td>
                  <td className={`num mono ${!f ? "muted" : r.floor < 0 ? "down" : "up"}`}>{!f ? "no floor quoted" : `${r.floor < 0 ? "−" : "+"}$${usdSmart(Math.abs(r.floor))}`}</td>
                  <td className="small muted hide-sm">{!f ? "" : r.p < f.strike ? `sell at $${usdK(f.strike)} while it trades at $${usdK(r.p)}` : "the floor expires unused; you keep the tokens"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="small muted" style={{ padding: "12px 20px 16px", margin: 0 }}>The floor costs its premium whatever happens and pays only when exercised; below the strike the loss stops at the premium plus the gap to the strike.</p>
        </div>
      </div>
      {publicKey && !cluster.programDeployed ? <div className="msg red" style={{ marginTop: 12 }} role="alert">Program not deployed on {cluster.label}; nothing to sign yet.</div> : null}
      <TxStatus state={tx.state} onRetry={tx.reset} doneHref="/positions" doneLabel="See it under Positions" />
      <p className="note" style={{ marginTop: 12 }}>Contracts can expire worthless. Maximum loss on the floor is its premium plus fees; the floor pays only if exercised. The token price itself is not protected below the strike minus the premium. The floor covers the swap&apos;s minimum out, so a slippage shortfall never leaves tokens uncovered.</p>
    </div>
  );
}
