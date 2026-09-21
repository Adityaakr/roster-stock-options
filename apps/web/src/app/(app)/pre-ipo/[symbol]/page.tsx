"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { LineChart, type Point } from "@/components/charts";
import { DiscoverTable } from "@/components/discover-table";
import { short, spreadLabel, TokenMark, type PreIpoTokenView } from "@/components/preipo";
import { Address, Badge, ErrorState, KV, Loading } from "@/components/ui";
import { useCluster, explorerUrl } from "@/lib/cluster";
import { usd, usd0, usdK } from "@/lib/format";
import { useRoster } from "@/lib/use-roster";

/*
 * One PreStocks token: where it trades and the issuer's mark on one chart, the spread between them, the valuations
 * both imply, the wrapper's facts read from the mint, the issuer's own terms, and the live Gap and Floor terms when
 * the token is listed here.
 */
interface Prices { mark: Point[]; issuerMark?: Point[] }

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
  const [days, setDays] = useState(7);
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
    fetch(`/api/prices/${marketMint}?days=${days}`, { cache: "no-store" }).then(async (r) => (r.ok ? ((await r.json()) as Prices) : null)).then(setPrices).catch(() => setPrices(null));
  }, [marketMint, days]);

  if (token === undefined) return <Loading what="the token" />;
  if (!token) return <ErrorState message={`${symbol} is not in the PreStocks registry.`} next={<Link className="link" href="/pre-ipo">Back to PreStocks</Link>} />;
  const listed = !!token.market && data?.underlying.symbol.toLowerCase() === symbol.toLowerCase();
  const series = [
    ...(prices?.mark.length ? [{ label: `${token.symbol} token price`, points: prices.mark }] : []),
    ...(prices?.issuerMark?.length ? [{ label: "issuer mark", points: prices.issuerMark, dashed: true, color: "var(--slate)" }] : [])
  ];
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
      </div>
      <div className="grid-2 split-left" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="flex items-center justify-between gap-3 flex-wrap" style={{ padding: "14px 20px", borderBottom: "1px solid var(--line)" }}>
            <div>
              <div className="h6">Token price and the mark</div>
              <div className="small muted" style={{ marginTop: 2 }}>{token.market ? "Both figures as the services record them every tick: the solid line is where the token trades, the dashed one the issuer's mark." : "Recorded only once the token is listed; the issuer's live figures are above."}</div>
            </div>
            <div className="seg" role="group" aria-label="Window">
              {[1, 7, 30].map((d) => <button key={d} className={days === d ? "on" : ""} onClick={() => setDays(d)}>{d === 1 ? "24h" : `${d}d`}</button>)}
            </div>
          </div>
          <div style={{ padding: "12px 16px 14px" }}>
            <LineChart series={series} format={(v) => `$${usd(v)}`} empty={token.market ? "No prices recorded yet on this cluster; the chart fills as the services tick." : "Not listed on this cluster, so nothing is recorded."} />
          </div>
          {token.market ? <div className="small muted" style={{ padding: "0 20px 14px" }}>Recent volatility {(token.market.vol * 100).toFixed(0)}% ({token.market.volSource === "recorded" ? "measured from the recorded token prices" : "a stated floor until a week of prices exists"}); the quoter prices off the token price and never off the mark.</div> : null}
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

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="flex items-center justify-between gap-3 flex-wrap" style={{ padding: "14px 20px", borderBottom: "1px solid var(--line)" }}>
          <div>
            <div className="h6">A known price on a known date, on {token.symbol}</div>
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
