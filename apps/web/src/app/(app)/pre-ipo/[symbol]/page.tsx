"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { LineChart, type Point } from "@/components/charts";
import { DiscoverTable } from "@/components/discover-table";
import { Address, Badge, ErrorState, KV, Loading, Stat } from "@/components/ui";
import { useCluster, explorerUrl } from "@/lib/cluster";
import { usd, usd0 } from "@/lib/format";
import { useRoster } from "@/lib/use-roster";

/*
 * One pre-IPO token (First Print, CLAUDE.md 5): the issuer's mark and token price with the implied discount, the
 * rights profile and the redemption terms, the fee and verdict read from the mint, the recorded price history, and
 * the live Gap terms when the token is listed here.
 */
interface Token {
  symbol: string; name: string; issuer: "Tessera" | "PreStocks"; mint: string; markPrice: number | null; tokenPrice: number | null; holders: number | null; sector: string | null; external: string | null; logo: string | null;
  discountPct: number | null; feeBps: number | null; decimals: number | null; verdict: string; reason: string; escrowProven: boolean; tier: number | null;
  market: { symbol: string; liveSeries: number; depthUsdc: number; bestAsk: number | null } | null;
  rights: { what: string; rights: string; exit: string };
}
interface Prices { mark: Point[] }

export default function PreIpoTokenPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = use(params);
  const cluster = useCluster();
  const [token, setToken] = useState<Token | null | undefined>(undefined);
  const [prices, setPrices] = useState<Prices | null>(null);
  const [days, setDays] = useState(7);
  const { data } = useRoster(symbol);
  useEffect(() => {
    fetch("/api/preipo", { cache: "no-store" }).then(async (r) => (await r.json()) as { tokens: Token[] }).then((j) => setToken(j.tokens.find((t) => t.symbol.toLowerCase() === symbol.toLowerCase()) ?? null)).catch(() => setToken(null));
  }, [symbol]);
  useEffect(() => {
    if (!token?.mint) return;
    fetch(`/api/prices/${token.mint}?days=${days}`, { cache: "no-store" }).then(async (r) => (r.ok ? ((await r.json()) as Prices) : null)).then(setPrices).catch(() => setPrices(null));
  }, [token?.mint, days]);

  if (token === undefined) return <Loading what="the token" />;
  if (!token) return <ErrorState message={`${symbol} is not in the Tessera or PreStocks registries.`} next={<Link className="link" href="/pre-ipo">Back to First Print</Link>} />;
  const listed = !!token.market && data?.underlying.symbol.toLowerCase() === symbol.toLowerCase();
  const price = token.tokenPrice ?? token.markPrice;

  return (
    <div>
      <div className="small" style={{ marginBottom: 14 }}><Link className="muted" href="/pre-ipo">First Print</Link> <span className="muted">/</span> {token.symbol}</div>
      <div className="page-head" style={{ alignItems: "flex-start" }}>
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="h3" style={{ margin: 0 }}>{token.symbol}</h1>
            <Badge tone={token.issuer === "Tessera" ? "purple" : "blue"}>{token.issuer}</Badge>
            <Badge tone={token.verdict.startsWith("eligible") ? "green" : token.verdict === "not checked" ? undefined : "amber"}>{token.verdict.replaceAll("_", " ")}</Badge>
            {token.market ? <Badge tone="green" dot>listed</Badge> : <Badge>not listed here</Badge>}
          </div>
          <p className="body-sm" style={{ margin: "4px 0 0" }}>{token.name}{token.sector ? ` · ${token.sector}` : ""} · {token.rights.what}</p>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="h3 mono" style={{ margin: 0 }}>{price === null ? "n/a" : `$${usd(price)}`}</div>
          <div className="small muted">{token.tokenPrice !== null ? "token price, per the issuer" : "issuer mark, per share"}</div>
        </div>
      </div>

      <div className="grid-4" style={{ marginBottom: 16 }}>
        <Stat k="Mark" v={token.markPrice === null ? "n/a" : `$${usd(token.markPrice)}`} s="the issuer's reference for the share" />
        <Stat k="Token price" v={token.tokenPrice === null ? "not published" : `$${usd(token.tokenPrice)}`} s={token.tokenPrice === null ? "Tessera publishes marks only" : "where the token trades"} />
        <Stat k="Discount to mark" v={token.discountPct === null ? "n/a" : `${token.discountPct > 0 ? "−" : "+"}${Math.abs(token.discountPct).toFixed(1)}%`} s="the price of having no exit" tone={token.discountPct === null ? undefined : token.discountPct > 0 ? "red" : "green"} />
        <Stat k="Holders" v={token.holders === null ? "n/a" : token.holders.toLocaleString("en-US")} s={token.holders === null ? "not published by the issuer" : "wallets, per the issuer"} />
      </div>

      <div className="grid-2 split-left" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="flex items-center justify-between gap-3 flex-wrap" style={{ padding: "14px 20px", borderBottom: "1px solid var(--line)" }}>
            <div>
              <div className="h6">Recorded price</div>
              <div className="small" style={{ marginTop: 2 }}>{token.market ? `The ${token.issuer} figure the services record every tick for this market.` : "Recorded only once the token is listed; the issuer&apos;s live figure is above."}</div>
            </div>
            <div className="seg" role="group" aria-label="Window">
              {[1, 7, 30].map((d) => <button key={d} className={days === d ? "on" : ""} onClick={() => setDays(d)}>{d === 1 ? "24h" : `${d}d`}</button>)}
            </div>
          </div>
          <div style={{ padding: "12px 16px 14px" }}>
            <LineChart series={prices?.mark.length ? [{ label: `${token.symbol} price`, points: prices.mark }] : []} format={(v) => `$${usd(v)}`} empty={token.market ? "No prices recorded yet on this cluster; the chart fills as the services tick." : "Not listed on this cluster, so nothing is recorded."} />
          </div>
        </div>
        <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
          <div className="card pad">
            <div className="h6">The wrapper</div>
            <div style={{ marginTop: 10 }}>
              <KV wrap items={[
                { k: "Mint", v: <Address value={token.mint} href={explorerUrl(cluster, "address", token.mint)} /> },
                { k: "Rights", v: token.rights.rights },
                { k: "Transfer fee", v: token.feeBps === null ? "not read" : token.feeBps === 0 ? "none" : `${(token.feeBps / 100).toFixed(2)}% on every transfer` },
                { k: "Decimals", v: <span className="mono">{token.decimals ?? "–"}</span> },
                { k: "Escrow", v: token.escrowProven ? "proven on the fork" : "not proven" },
                { k: "Issuer", v: token.external ? <a className="link" href={token.external} target="_blank" rel="noreferrer">{token.issuer} page</a> : token.issuer }
              ]} />
            </div>
          </div>
          <div className="card pad">
            <div className="h6">{token.issuer === "Tessera" ? "The redemption cliff" : "The price of no exit"}</div>
            <p className="body-sm" style={{ margin: "6px 0 0" }}>{token.rights.exit}</p>
            {token.feeBps ? <p className="body-sm" style={{ margin: "8px 0 0" }}>A Gap here is a known price on a known date. The {(token.feeBps / 100).toFixed(2)}% fee is taken by the mint on every transfer, so exercise delivers the raw amount less the fee, and Floors wait for fee-inclusive settlement.</p> : null}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--line)" }}>
          <div className="h6">Funded exits on {token.symbol}</div>
          <div className="small" style={{ marginTop: 2 }}>{listed ? `${token.market!.liveSeries} Gap series live · $${usd0(token.market!.depthUsdc)} executable depth${token.market!.bestAsk !== null ? ` · best ask $${usd(token.market!.bestAsk)} per share` : ""}` : "Not listed on this cluster. Tier 3 names can be quoted by any underwriter once their escrow is proven."}</div>
        </div>
        {listed && data ? <div style={{ padding: "14px 16px 6px" }}><DiscoverTable data={data} initialSide="call" /></div> : null}
      </div>
      <p className="small">Issuer figures read now from {token.issuer === "Tessera" ? "rest-api.tessera.pe" : "prestocks.com/api"}; mint facts and the verdict from the registry run. Pre-IPO tokens have no Pyth feed: the issuer&apos;s own figure prices these terms and auto-exercise is off on them.</p>
    </div>
  );
}
