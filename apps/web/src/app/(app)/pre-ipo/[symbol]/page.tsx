"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { LineChart, type Point } from "@/components/charts";
import { DiscoverTable } from "@/components/discover-table";
import { short, spreadLabel, TokenMark, type PreIpoTokenView } from "@/components/preipo";
import { Address, Badge, ErrorState, KV, Loading } from "@/components/ui";
import { useCluster, explorerUrl } from "@/lib/cluster";
import { usd, usd0, usdK, dayLabel } from "@/lib/format";
import { useRoster } from "@/lib/use-roster";

/*
 * One PreStocks token: where it trades and the issuer's mark on one chart, the spread between them, the valuations
 * both imply, the wrapper's facts read from the mint, the issuer's own terms, and the live Gap and Floor terms when
 * the token is listed here.
 */
interface Prices { mark: Point[]; issuerMark?: Point[]; tradeDaily?: Point[]; tradeHourly?: Point[] }
type Window = "1d" | "7d" | "30d" | "all";
const DAYS: Record<Window, number> = { "1d": 1, "7d": 7, "30d": 30, all: 400 };

function Fig({ k, v, s, tone }: { k: string; v: string; s: string; tone?: "up" | "down" }) {
  return (
    <div className="card pfig">
      <div className="k">{k}</div>
      <div className={`v mono ${tone ?? ""}`}>{v}</div>
      <div className="s">{s}</div>
    </div>
  );
}

export default function PreIpoTokenPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = use(params);
  const cluster = useCluster();
  const [token, setToken] = useState<PreIpoTokenView | null | undefined>(undefined);
  const [prices, setPrices] = useState<Prices | null>(null);
  const [win, setWin] = useState<Window>("30d");
  const { data } = useRoster(symbol);
  useEffect(() => {
    // One failed read of the issuer must not read as "not in the registry": retry a few times before giving up.
    let tries = 0;
    const load = () => fetch("/api/preipo", { cache: "no-store" }).then(async (r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return (await r.json()) as { tokens: PreIpoTokenView[] }; }).then((j) => setToken(j.tokens.find((t) => t.symbol.toLowerCase() === symbol.toLowerCase()) ?? null)).catch(() => { if (++tries < 4) setTimeout(load, 2_000); else setToken(null); });
    load();
  }, [symbol]);
  const marketMint = token?.market?.mint;
  useEffect(() => {
    if (!marketMint) return;
    fetch(`/api/prices/${marketMint}?days=${DAYS[win]}`, { cache: "no-store" }).then(async (r) => (r.ok ? ((await r.json()) as Prices) : null)).then(setPrices).catch(() => setPrices(null));
  }, [marketMint, win]);

  if (token === undefined) return <Loading what="the token" />;
  if (!token) return <ErrorState message={`${symbol} is not in the PreStocks registry.`} next={<Link className="link" href="/pre-ipo">Back to PreStocks</Link>} />;
  const listed = !!token.market && data?.underlying.symbol.toLowerCase() === symbol.toLowerCase();
  // The chart is the mainnet token's real trades: hourly closes for a day or a week, daily closes beyond; the issuer's
  // mark is drawn dashed over the part of the window this cluster has recorded it for.
  const trade = win === "1d" || win === "7d" ? (prices?.tradeHourly ?? []) : (prices?.tradeDaily ?? []);
  const series = [
    ...(trade.length ? [{ label: `${token.symbol} on ${token.market?.trade?.pool ?? "its reference pool"}`, points: trade }] : []),
    ...(prices?.issuerMark?.length ? [{ label: "issuer mark", points: prices.issuerMark, dashed: true, color: "var(--slate)" }] : [])
  ];
  const tr = token.market?.trade ?? null;
  const bestFloor = data?.terms.filter((t) => t.side === "put" && t.ask > 0 && t.capacity > 0).sort((a, b) => b.strike - a.strike)[0];
  const bestGap = data?.terms.filter((t) => t.side === "call" && t.ask > 0 && t.capacity > 0).sort((a, b) => a.strike - b.strike)[0];
  const calls = data?.terms.filter((t) => t.side === "call" && t.ask > 0).length ?? 0;
  const puts = data?.terms.filter((t) => t.side === "put" && t.ask > 0).length ?? 0;

  return (
    <div>
      <div className="small" style={{ marginBottom: 14 }}><Link className="muted" href="/pre-ipo">PreStocks</Link> <span className="muted">/</span> {token.symbol}</div>
      <div className="page-head" style={{ alignItems: "flex-start" }}>
        <div className="flex items-start gap-4">
          <TokenMark t={token} size={52} />
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 style={{ margin: 0 }}>{token.symbol}</h1>
              <Badge tone="blue">PreStocks</Badge>
              <Badge tone={token.verdict.startsWith("eligible") ? "green" : token.verdict === "not checked" ? undefined : "amber"}>{token.escrowProven ? "escrow proven" : token.verdict.replaceAll("_", " ")}</Badge>
              {token.market ? <Badge tone="green" dot>listed</Badge> : <Badge>not listed here</Badge>}
            </div>
            <p style={{ margin: "4px 0 0" }}>{token.description ?? token.name}</p>
            <div className="flex items-center gap-2 flex-wrap" style={{ marginTop: 10 }}>
              {token.external ? <a className="chip" href={token.external} target="_blank" rel="noreferrer">Company site ↗</a> : null}
              <a className="chip" href="https://prestocks.com/products" target="_blank" rel="noreferrer">On PreStocks ↗</a>
              <a className="chip" href={`https://jup.ag/swap/USDC-${token.mint}`} target="_blank" rel="noreferrer">Buy the token on Jupiter ↗</a>
              <a className="chip" href={`https://solscan.io/token/${token.mint}`} target="_blank" rel="noreferrer">Mint on Solscan ↗</a>
            </div>
          </div>
        </div>
        <div className="hstat" style={{ textAlign: "right" }}>
          <span>token price</span>
          <b className="mono" style={{ fontSize: 28 }}>{token.tokenPrice === null ? "n/a" : `$${usd(token.tokenPrice)}`}</b>
          <span className={token.spreadPct === null ? "muted" : token.spreadPct >= 0 ? "up" : "down"}>{spreadLabel(token.spreadPct)} the mark of ${usd(token.markPrice ?? 0)}</span>
        </div>
      </div>

      <div className="pfigs" style={{ marginBottom: 16 }}>
        <Fig k="Token price" v={token.tokenPrice === null ? "n/a" : `$${usd(token.tokenPrice)}`} s="where the token trades, per the issuer's API" />
        <Fig k="Implied valuation" v={token.impliedValuation === null ? "n/a" : `$${short(token.impliedValuation)}`} s="the company, at the token price" />
        <Fig k={token.spreadPct !== null && token.spreadPct < 0 ? "Discount to the mark" : "Premium to the mark"} v={token.spreadPct === null ? "n/a" : `${token.spreadPct >= 0 ? "+" : "−"}${Math.abs(token.spreadPct).toFixed(1)}%`} s={token.spreadPct === null ? "" : token.spreadPct >= 0 ? "the token costs more than the share it tracks" : "the token costs less than the share it tracks"} tone={token.spreadPct === null ? undefined : token.spreadPct >= 0 ? "up" : "down"} />
        <Fig k="Mark price" v={token.markPrice === null ? "n/a" : `$${usd(token.markPrice)}`} s="the gross price per share, per the issuer" />
        <Fig k="Mark valuation" v={token.markValuation === null ? "n/a" : `$${short(token.markValuation)}`} s="the company, at the mark" />
        <Fig k="Market cap" v={token.tokenPrice && token.supply ? `$${short(token.tokenPrice * token.supply)}` : "n/a"} s={token.supply ? `${usdK(token.supply)} tokens at the token price` : "supply not published"} />
        <Fig k="24h" v={tr?.change24hPct === null || tr?.change24hPct === undefined ? "…" : `${tr.change24hPct >= 0 ? "+" : "−"}${Math.abs(tr.change24hPct).toFixed(1)}%`} s="from the reference pool's trades" tone={tr?.change24hPct === null || tr?.change24hPct === undefined ? undefined : tr.change24hPct >= 0 ? "up" : "down"} />
        <Fig k="7 days" v={tr?.change7dPct === null || tr?.change7dPct === undefined ? "…" : `${tr.change7dPct >= 0 ? "+" : "−"}${Math.abs(tr.change7dPct).toFixed(1)}%`} s={tr ? `${tr.days} days of trades recorded` : "reading the pool"} tone={tr?.change7dPct === null || tr?.change7dPct === undefined ? undefined : tr.change7dPct >= 0 ? "up" : "down"} />
        <Fig k="Liquidity" v={tr?.liquidityUsd ? `$${short(tr.liquidityUsd)}` : "…"} s={tr?.volume24hUsd ? `$${short(tr.volume24hUsd)} traded in 24h on ${tr.pool}` : tr ? tr.pool : "the deepest USDC pool"} />
      </div>
      <div className="grid-2 split-left" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="flex items-center justify-between gap-3 flex-wrap" style={{ padding: "14px 20px", borderBottom: "1px solid var(--line)" }}>
            <div>
              <div className="h6">Where the token has traded</div>
              <div className="small muted" style={{ marginTop: 2 }}>{tr ? `Closes from ${tr.pool} on mainnet, the deepest USDC pool for the token; the dashed line is the issuer's mark where this cluster has recorded it.` : "Reading the token's reference pool on mainnet; the issuer's live figures are above."}</div>
            </div>
            <div className="seg" role="group" aria-label="Window">
              {(["1d", "7d", "30d", "all"] as Window[]).map((w) => <button key={w} className={win === w ? "on" : ""} onClick={() => setWin(w)}>{w === "1d" ? "24h" : w === "all" ? "All" : w}</button>)}
            </div>
          </div>
          <div style={{ padding: "12px 16px 14px" }}>
            <LineChart series={series} format={(v) => `$${usd(v)}`} timeFormat={win === "1d" || win === "7d" ? undefined : (t) => new Date(t * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" })} empty={tr ? "No trades in this window." : "Reading the token's trade history from its reference pool."} />
          </div>
          {token.market ? <div className="small muted" style={{ padding: "0 20px 14px" }}>Recent volatility {(token.market.vol * 100).toFixed(0)}% annualised ({token.market.volSource === "recorded" ? "measured from the pool's daily closes over 7, 30 and 90 days" : "a stated floor until a week of closes exists"}); the quoter prices every term off the token price and never off the mark.</div> : null}
        </div>
        <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
          <div className="card pad">
            <div className="h6">The wrapper</div>
            <div style={{ marginTop: 10 }}>
              <KV wrap items={[
                { k: "Mint on mainnet", v: <Address value={token.mint} href={`https://solscan.io/token/${token.mint}`} /> },
                ...(token.market && token.market.mint !== token.mint ? [{ k: "Replica here", v: <Address value={token.market.mint} href={explorerUrl(cluster, "address", token.market.mint)} /> }] : []),
                { k: "Backing", v: token.rights.what },
                { k: "Rights", v: token.rights.rights },
                { k: "Transfer fee", v: token.feeBps === null ? "not read" : token.feeBps === 0 ? "none" : `${(token.feeBps / 100).toFixed(2)}% on every transfer` },
                { k: "Decimals", v: <span className="mono">{token.decimals ?? "–"}</span> },
                { k: "Escrow", v: token.escrowProven ? "a lot in and out of a series vault, on chain" : "not proven" },
                { k: "Issuer", v: token.external ? <a className="link" href={token.external} target="_blank" rel="noreferrer">the company</a> : "PreStocks" }
              ]} />
            </div>
          </div>
          <div className="card pad">
            <div className="h6">PreStocks&apos; own terms</div>
            <div className="ask-rows" style={{ marginTop: 8 }}>
              <div><span>Exit</span><b style={{ fontWeight: 400 }}>{token.rights.exit}</b></div>
              <div><span>On an IPO</span><b style={{ fontWeight: 400 }}>{token.rights.ipo}</b></div>
              <div><span>On a deal</span><b style={{ fontWeight: 400 }}>{token.rights.mna}</b></div>
            </div>
          </div>
        </div>
      </div>

      {listed && data ? (
        <div className="pdo" style={{ marginBottom: 16 }}>
          <Link href={bestFloor ? `/trade/${bestFloor.id}` : `/markets/${token.symbol}`} className="card pdo-card">
            <Badge tone="blue">Floor</Badge>
            <b>A known price on a known date</b>
            <span>Sell {token.symbol} at the strike any time through the date. The USDC is locked before you buy; no oracle can block the exit.</span>
            {bestFloor ? <em className="mono">${usdK(bestFloor.strike)} through {dayLabel(bestFloor.expiryTs)} · ${usd(bestFloor.ask)} per token</em> : <em className="muted">no floor quoted right now</em>}
          </Link>
          <Link href={bestGap ? `/trade/${bestGap.id}` : `/markets/${token.symbol}`} className="card pdo-card">
            <Badge tone="green">Gap</Badge>
            <b>The upside with the loss capped</b>
            <span>The right to buy {token.symbol} at the strike through the date. If it never gets there you lose the premium and nothing else.</span>
            {bestGap ? <em className="mono">${usdK(bestGap.strike)} through {dayLabel(bestGap.expiryTs)} · ${usd(bestGap.ask)} per token</em> : <em className="muted">no gap quoted right now</em>}
          </Link>
          <Link href={`/underwrite?m=${token.symbol}`} className="card pdo-card">
            <Badge>Earn</Badge>
            <b>Get paid to take the other side</b>
            <span>Hold {token.symbol} and be paid to sell it higher, or lock USDC and be paid to buy it lower. Paid risk, never yield.</span>
            {bestFloor ? <em className="mono">writing the ${usdK(bestFloor.strike)} floor pays ${usd(bestFloor.ask)} per token</em> : <em className="muted">quote the first ask</em>}
          </Link>
        </div>
      ) : null}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="flex items-center justify-between gap-3 flex-wrap" style={{ padding: "14px 20px", borderBottom: "1px solid var(--line)" }}>
          <div>
            <div className="h6">Every live term on {token.symbol}</div>
            <div className="small muted" style={{ marginTop: 2 }}>{listed ? `${calls} Gap and ${puts} Floor terms quoted · $${usd0(token.market!.depthUsdc)} executable depth${token.market!.bestAsk !== null ? ` · best ask $${usd(token.market!.bestAsk)} per token` : ""}. A Floor is the funded exit: sell at the strike any time through the date, USDC already locked.` : "Not listed on this cluster. Tier 3 names can be quoted by any underwriter once their escrow is proven."}</div>
          </div>
          {listed ? <div className="flex items-center gap-2"><Link href={`/underwrite?m=${token.symbol}`} className="btn secondary sm">Earn on {token.symbol}</Link><Link href={`/vaults`} className="btn secondary sm">Vaults</Link></div> : null}
        </div>
        {listed && data ? <div style={{ padding: "14px 16px 6px" }}><DiscoverTable data={data} initialSide="put" /></div> : null}
        {listed && token.feeBps ? <p className="small muted" style={{ padding: "0 20px 14px", margin: 0 }}>The mint&apos;s {(token.feeBps / 100).toFixed(2)}% fee is the holder&apos;s on both sides: a Gap delivers the tokens less the fee; a Floor has you deliver the fee on top so the writers receive every unit they are owed. The ticket states both in numbers.</p> : null}
      </div>
      <p className="small">Figures read now from prestocks.com/api; mint facts and the verdict from the registry run. PreStocks tokens have no Pyth feed: the token price prices these terms and auto-exercise is off on them.</p>
    </div>
  );
}
