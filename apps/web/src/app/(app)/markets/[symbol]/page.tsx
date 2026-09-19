"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bars, LineChart, type Point } from "@/components/charts";
import { DiscoverTable } from "@/components/discover-table";
import { MarketLogo } from "@/components/market-list";
import { Address, Badge, ErrorState, KV, Loading } from "@/components/ui";
import { useCluster, explorerUrl } from "@/lib/cluster";
import { usd, usd0, usdK, dayLabel, countdown, timeLabel } from "@/lib/format";
import { SESSION_LABEL, TIER_LABEL, TIER_RULE } from "@/lib/model";
import { useRoster } from "@/lib/use-roster";

/*
 * One market, complete (Part 2 section 6, Discover): the mark and its history, the term grid, depth per expiry, the
 * roster behind it (underwriters and quotes at size), the wrapper&apos;s rights profile read from the mint, and the
 * exercise history. Everything on this page is read from the services; nothing is invented.
 */
interface Prices { mark: Point[]; token: Point[]; equity: Point[]; basis: { bps: number; at: number }[] }
interface Wrapper { symbol: string; name: string; issuer: string; mint: string; tier: number; holders: number | null; verdict: string; reason: string; feeBps: number; tokenFeed: string | null; escrowProven: boolean; status: string; market: { symbol: string; mark: number | null; bestAsk: number | null; depthUsdc: number; liveSeries: number; tier: number } | null }

export default function MarketPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = use(params);
  const router = useRouter();
  const { data, error } = useRoster(symbol);
  const cluster = useCluster();
  const [days, setDays] = useState(1);
  const [prices, setPrices] = useState<Prices | null>(null);
  const [wrappers, setWrappers] = useState<Wrapper[]>([]);
  const mint = data?.underlying.mint ?? null;
  const underlying = data?.markets.find((x) => x.symbol.toLowerCase() === symbol.toLowerCase())?.underlyingSymbol ?? null;
  useEffect(() => {
    if (!underlying) return;
    fetch(`/api/wrappers?underlying=${encodeURIComponent(underlying)}`, { cache: "no-store" }).then(async (r) => (r.ok ? ((await r.json()) as { underlyings: { wrappers: Wrapper[] }[] }) : null)).then((j) => setWrappers(j?.underlyings[0]?.wrappers ?? [])).catch(() => setWrappers([]));
  }, [underlying]);
  useEffect(() => {
    if (!mint) return;
    fetch(`/api/prices/${mint}?days=${days}`, { cache: "no-store" }).then(async (r) => (r.ok ? ((await r.json()) as Prices) : null)).then((p) => setPrices(p)).catch(() => setPrices(null));
  }, [mint, days]);

  if (error) return <ErrorState message={`Could not read the market: ${error}`} next="Reload the page." />;
  if (!data) return <Loading what="the market" />;
  const m = data.markets.find((x) => x.symbol.toLowerCase() === symbol.toLowerCase());
  const u = data.underlying;
  if (!m || u.symbol.toLowerCase() !== symbol.toLowerCase()) return <ErrorState message={`${symbol} is not a listed market.`} next={<Link className="link" href="/markets">Back to the markets</Link>} />;
  const byExpiry = data.expiries.map((e) => ({ label: dayLabel(e), sub: `in ${countdown(e, data.nowTs)}`, value: data.terms.filter((t) => t.expiryTs === e).reduce((a, t) => a + t.capacity * t.strike, 0) }));
  const live = data.underwriters.filter((w) => w.live);
  const bestGap = data.terms.filter((t) => t.side === "call" && t.ladder[0]?.ask !== null).sort((a, b) => a.expiryTs - b.expiryTs || a.strike - b.strike);
  const bestFloor = data.terms.filter((t) => t.side === "put" && t.ladder[0]?.ask !== null).sort((a, b) => a.expiryTs - b.expiryTs || b.strike - a.strike);
  const series = [
    ...(prices?.mark.length ? [{ label: `${m.symbol} mark`, points: prices.mark }] : []),
    ...(prices?.equity.length ? [{ label: `${m.name.replace(/ xStock$/, "")} equity`, points: prices.equity, color: "var(--slate)", dashed: true }] : [])
  ];

  return (
    <div>
      <div className="small" style={{ marginBottom: 14 }}><Link className="muted" href="/markets">Markets</Link> <span className="muted">/</span> {m.symbol}</div>
      <div className="page-head" style={{ alignItems: "flex-start" }}>
        <div className="flex items-center gap-4">
          <MarketLogo m={m} size={44} />
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="h3" style={{ margin: 0 }}>{m.symbol}</h1>
              <Badge tone={m.tier === 1 ? "green" : m.tier === 2 ? "blue" : undefined}>{TIER_LABEL[m.tier]}</Badge>
              <Badge>{m.wrapperTier}</Badge>
              {m.paused ? <Badge tone="amber" dot>paused</Badge> : null}
              {m.replicaOf ? <Badge tone="amber">devnet replica</Badge> : null}
              <Badge tone={data.session === "regular" ? "green" : "amber"} dot>{SESSION_LABEL[data.session]}</Badge>
            </div>
            <p className="body-sm" style={{ margin: "4px 0 0" }}>{m.name} · {m.liveSeries > m.maxLiveSeries ? `${m.liveSeries} series live` : `${m.liveSeries} of ${m.maxLiveSeries} series live`} · {live.length} underwriter{live.length === 1 ? "" : "s"} quoting</p>
            {m.replicaOf ? (
              <p className="small muted" style={{ margin: "4px 0 0" }}>
                A devnet token with the same extensions as the mainnet mint, priced from it:{" "}
                <Address value={m.replicaOf} href={`https://solscan.io/token/${m.replicaOf}`} />. The issuer&apos;s own token is not on devnet.
              </p>
            ) : null}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="h3 mono" style={{ margin: 0 }}>{m.mark === null ? "no feed" : `$${usd(m.mark)}`}</div>
          <div className={`small ${m.changePct === null ? "muted" : m.changePct >= 0 ? "up" : "down"}`}>{m.changePct === null ? "no recorded history yet" : `${m.changePct >= 0 ? "+" : "−"}${Math.abs(m.changePct).toFixed(2)}% over the recorded day`}</div>
        </div>
      </div>

      <div className="grid-2 split-left" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="flex items-center justify-between gap-3 flex-wrap" style={{ padding: "14px 20px", borderBottom: "1px solid var(--line)" }}>
            <div>
              <div className="h6">Mark</div>
              <div className="small" style={{ marginTop: 2 }}>{m.priceSource === "hermes" ? "Pyth Hermes token feed" : m.priceSource === "xstocks" ? "xStocks issuer quote (no Pyth entitlement on this cluster)" : m.priceSource === "jupiter" ? "Jupiter routed price (no Pyth entitlement, no issuer quote)" : m.priceSource === "tessera" ? "Tessera published mark" : m.priceSource === "prestocks" ? "PreStocks token price" : m.priceSource === "reference" ? "fork reference price" : "no feed"}, recorded every tick</div>
            </div>
            <div className="seg" role="group" aria-label="Window">
              {[1, 7, 30].map((d) => <button key={d} className={days === d ? "on" : ""} onClick={() => setDays(d)}>{d === 1 ? "24h" : `${d}d`}</button>)}
            </div>
          </div>
          <div style={{ padding: "12px 16px 14px" }}>
            <LineChart series={series} height={320} format={(v) => `$${usd(v)}`} empty="No marks recorded yet on this cluster; the chart fills as the services tick." />
          </div>
        </div>
        <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
          <div className="card pad">
            <div className="h6">Right now</div>
            <div style={{ marginTop: 10 }}>
              <KV items={[
                { k: "Equity reference", v: <span className="mono">{u.equityMark ? `$${usd(u.equityMark)}` : "closed"}</span> },
                { k: "Token vs share basis", v: <span className="mono">{u.basisBps === null ? "n/a" : `${u.basisBps >= 0 ? "+" : ""}${u.basisBps} bps`}</span> },
                { k: "Volatility used", v: <span className="mono">{(m.vol * 100).toFixed(0)}% <span className="small muted">{m.volSource === "fixture" ? "fixture" : m.volSource.includes("floor") ? "floor" : m.volSource}</span></span> },
                { k: "Multiplier", v: <span className="mono">{u.multiplier.toFixed(4)}×</span> },
                { k: "Executable depth", v: <span className="mono">${usd0(m.depthUsdc)}</span> },
                { k: "Nearest expiry", v: data.expiries[0] ? `${dayLabel(data.expiries[0])} · ${countdown(data.expiries[0], data.nowTs)}` : "none" }
              ]} />
            </div>
          </div>
          <div className="card pad">
            <div className="h6">Trade now</div>
            <div className="small muted" style={{ marginTop: 2 }}>The cheapest live term each side. Every other strike is in the grid below.</div>
            <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
              {bestGap[0] ? <Link className="term-pick" href={`/trade/${bestGap[0].id}`} data-testid="buy-gap"><span><b>Buy a Gap</b> <span className="muted">${usdK(bestGap[0].strike)} · {dayLabel(bestGap[0].expiryTs)}</span></span><span className="mono">${usd(bestGap[0].ladder[0]!.ask!)} / share</span><span className="pick-go">Buy →</span></Link> : <div className="small muted">No Gap quoted right now.</div>}
              {bestFloor[0] ? <Link className="term-pick" href={`/trade/${bestFloor[0].id}`} data-testid="buy-floor"><span><b>Buy a Floor</b> <span className="muted">${usdK(bestFloor[0].strike)} · {dayLabel(bestFloor[0].expiryTs)}</span></span><span className="mono">${usd(bestFloor[0].ladder[0]!.ask!)} / share</span><span className="pick-go">Buy →</span></Link> : <div className="small muted">{m.hasTransferFee ? "Floors wait for fee-inclusive settlement on this mint." : "No Floor quoted right now."}</div>}
              <Link className="btn secondary sm" href={`/underwrite?m=${m.symbol}`} style={{ justifySelf: "start", marginTop: 4 }}>Underwrite {m.symbol}</Link>
            </div>
          </div>
        </div>
      </div>

      {u.pendingActivationTs ? <div className="card pad msg" role="status" style={{ padding: "12px 16px", marginBottom: 16, color: "var(--amber)" }}>A multiplier activation is scheduled for {dayLabel(u.pendingActivationTs)}. Quotes widen or pause around it; strikes are shown per share at the live multiplier.</div> : null}

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--line)" }}>
          <div className="h6">Terms</div>
          <div className="small" style={{ marginTop: 2 }}>Every live term on {m.symbol}. Pick a side, set a size, select a row to see the payoff and the quote that backs it.</div>
        </div>
        <div style={{ padding: "14px 16px 6px" }}>
          <DiscoverTable data={data} />
        </div>
      </div>

      <div className="grid-2" style={{ marginBottom: 16 }}>
        <div className="card pad">
          <div className="h6">Depth by expiry</div>
          <div className="small" style={{ margin: "2px 0 14px" }}>USDC notional fillable now on each expiry&apos;s terms.</div>
          {byExpiry.length ? <Bars rows={byExpiry} format={(v) => `$${usd0(v)}`} /> : <div className="small muted">No expiry on the grid.</div>}
        </div>
        <div className="card pad">
          <div className="h6">The roster behind {m.symbol}</div>
          <div className="small" style={{ margin: "2px 0 14px" }}>Who is quoting and what they have locked in the series vaults.</div>
          {data.underwriters.length === 0 ? <div className="small muted">No underwriter has quoted this market yet.</div> : (
            <table className="table">
              <thead><tr><th>Underwriter</th><th className="num">USDC</th><th className="num">{m.symbol}</th><th className="num">Account</th></tr></thead>
              <tbody>
                {data.underwriters.map((w) => (
                  <tr key={w.name}>
                    <td><div className="flex items-center gap-2">{w.name}<Badge tone={w.live ? "green" : undefined} dot={w.live}>{w.live ? "live" : "idle"}</Badge></div></td>
                    <td className="num">${usd0(w.usdcReserved)}</td>
                    <td className="num">{Math.floor(w.underlyingReserved)}</td>
                    <td className="num">{w.account ? <Address value={w.account} href={explorerUrl(cluster, "address", w.account)} /> : <span className="muted">linked at deploy</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {wrappers.length > 1 ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--line)" }}>
            <div className="h6">Every wrapper of {underlying} on Solana</div>
            <div className="small" style={{ marginTop: 2 }}>The same stock from more than one issuer. Each one is judged on its own mint; a listed wrapper is its own market with its own roster, so the best price and depth can be compared here.</div>
          </div>
          <div className="scroll-x">
            <table className="table">
              <thead><tr><th>Wrapper</th><th>Issuer</th><th className="num">Mark</th><th className="num">Best ask</th><th className="num">Depth</th><th className="num">Holders</th><th>Feed</th><th>Status</th></tr></thead>
              <tbody>
                {wrappers.map((w) => (
                  <tr key={w.mint} className={w.market ? "row-link" : ""} onClick={() => { if (w.market) router.push(`/markets/${w.market.symbol}`); }} style={w.symbol === m.symbol ? { background: "var(--surface)" } : undefined}>
                    <td><div style={{ fontWeight: 500 }}>{w.market ? <Link href={`/markets/${w.market.symbol}`} onClick={(e) => e.stopPropagation()}>{w.symbol}</Link> : w.symbol}{w.symbol === m.symbol ? <span className="small muted"> · this page</span> : null}</div><div className="small muted">{w.name}</div></td>
                    <td><Badge>{w.issuer === "xStock" ? "xStocks" : w.issuer}</Badge></td>
                    <td className="num">{w.market?.mark != null ? `$${usd(w.market.mark)}` : <span className="muted">–</span>}</td>
                    <td className="num">{w.market?.bestAsk != null ? `$${usd(w.market.bestAsk)}` : <span className="muted">–</span>}</td>
                    <td className="num">{w.market ? (w.market.depthUsdc > 0 ? `$${usd0(w.market.depthUsdc)}` : <span className="muted" title="Tier 3: no treasury capital; any underwriter may quote">none yet</span>) : <span className="muted">–</span>}</td>
                    <td className="num">{w.holders === null ? <span className="muted">–</span> : w.holders.toLocaleString("en-US")}</td>
                    <td className="small">{w.tokenFeed ? <span className="mono">{w.tokenFeed}</span> : <span className="muted">none on Pyth</span>}</td>
                    <td><Badge tone={w.status === "listed" ? "green" : w.status === "restricted" || w.status === "ineligible" ? "amber" : undefined} dot={w.status === "listed"}>{w.status === "listed" ? `listed · ${TIER_LABEL[(w.market!.tier as 1 | 2 | 3)]}` : w.status}</Badge>{w.reason && w.status !== "listed" ? <div className="small muted" style={{ maxWidth: 260 }}>{w.reason}</div> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="grid-2" style={{ marginBottom: 16 }}>
        <div className="card pad">
          <div className="h6">The wrapper</div>
          <div className="small" style={{ margin: "2px 0 12px" }}>Read from the mint. What the issuer can do to this token, and so to a contract on it.</div>
          <KV wrap items={[
            { k: "Mint", v: m.mint ? <Address value={m.mint} href={explorerUrl(cluster, "address", m.mint)} /> : "none" },
            { k: "Decimals", v: <span className="mono">{m.decimals}</span> },
            { k: "Permanent delegate", v: m.hasPermanentDelegate ? "yes: the issuer can move tokens from any account, including a vault" : "no" },
            { k: "Pausable", v: m.pausable ? "yes: a pause halts every series until the resume, and expiry extends 24 hours" : "no" },
            { k: "Transfer fee", v: m.feeBps > 0 ? `${(m.feeBps / 100).toFixed(2)}% on every transfer; exercise delivers the raw amount less the fee` : "none" },
            { k: "Rights", v: m.wrapperTier === "xStock" ? "tracker certificate, no voting rights; dividends reinvested through the multiplier" : m.wrapperTier === "Ondo" ? "Ondo tokenized stock; no voting rights, corporate actions through the issuer's multiplier" : m.wrapperTier === "Tessera" ? "loan participation rights, not securities" : "SPV exposure, no ownership, voting or dividend rights" }
          ]} />
        </div>
        <div className="card">
          <div style={{ padding: "16px 20px 12px", borderBottom: "1px solid var(--line)" }}>
            <div className="h6">Exercise history</div>
            <div className="small" style={{ marginTop: 2 }}>Every exercise on {m.symbol}, including the ones that declined.</div>
          </div>
          <div className="scroll-x">
            <table className="table">
              <thead><tr><th>When</th><th>Event</th><th className="num">Size</th><th className="num">Signature</th></tr></thead>
              <tbody>
                {data.exercises.length === 0 ? <tr><td colSpan={4} className="muted">No exercises yet on this cluster.</td></tr> : data.exercises.slice(0, 8).map((e, i) => (
                  <tr key={i}>
                    <td className="small mono">{timeLabel(e.ts)}</td>
                    <td>{e.kind === "auto_exercise" ? "Auto-exercise" : "Exercise"} {e.ok ? null : <Badge tone="amber">declined</Badge>}<div className="small">{e.note}</div></td>
                    <td className="num">{e.shares} {m.symbol}</td>
                    <td className="num">{e.signature ? <Address value={e.signature} n={5} href={explorerUrl(cluster, "tx", e.signature)} /> : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <p className="small" style={{ marginTop: 4 }}>{TIER_LABEL[m.tier]}: {TIER_RULE[m.tier]} {data.source}</p>
    </div>
  );
}
