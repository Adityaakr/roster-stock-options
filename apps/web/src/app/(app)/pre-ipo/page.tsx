"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Address, Badge, ErrorState, Loading } from "@/components/ui";
import { useCluster, explorerUrl } from "@/lib/cluster";
import { usd, usd0 } from "@/lib/format";

/*
 * First Print (CLAUDE.md 5): the registry of Tessera and PreStocks tokens, live from the issuers, with the rights
 * profile, mark versus token price and the implied discount, the transfer fee read from the mint, and the funded-exit
 * terms: a Gap on a listed token, Floors withheld until fee-inclusive settlement. The redemption cliff on every
 * Tessera ticket.
 */
interface Token {
  symbol: string; name: string; issuer: "Tessera" | "PreStocks"; mint: string; markPrice: number | null; tokenPrice: number | null; holders: number | null; sector: string | null; external: string | null;
  discountPct: number | null; feeBps: number | null; decimals: number | null; verdict: string; reason: string; escrowProven: boolean; tier: number | null;
  market: { symbol: string; liveSeries: number; depthUsdc: number; bestAsk: number | null } | null;
  rights: { what: string; rights: string; exit: string };
}

export default function PreIpoPage() {
  const cluster = useCluster();
  const [data, setData] = useState<{ tokens: Token[]; generatedAt: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/preipo", { cache: "no-store" }).then(async (r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return (await r.json()) as { tokens: Token[]; generatedAt: string | null }; }).then(setData).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  if (error) return <ErrorState message={`Could not read the pre-IPO registries: ${error}`} next="Reload the page." />;
  if (!data) return <Loading what="the registries" />;
  const listed = data.tokens.filter((t) => t.market);
  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="h3">First Print</h1>
          <p className="body-sm">Funded exits on the assets with no exit at all. Rights profile, mark versus token price, the fee read from the mint, and the redemption cliff on every ticket. Live from Tessera and PreStocks.</p>
        </div>
        <Badge tone={listed.length ? "green" : "amber"} dot>{listed.length} listed on {cluster.label}</Badge>
      </div>
      <div className="card scroll-x" style={{ marginBottom: 16 }}>
        <table className="table" style={{ minWidth: 1000 }}>
          <thead>
            <tr><th>Token</th><th>Issuer</th><th>Mint</th><th className="num">Mark</th><th className="num">Token price</th><th className="num">Discount</th><th className="num">Holders</th><th>Transfer fee</th><th>Verdict</th><th>Market</th></tr>
          </thead>
          <tbody>
            {data.tokens.map((t) => (
              <tr key={t.mint} data-testid="preipo-row">
                <td><div style={{ fontWeight: 500 }}>{t.symbol}</div><div className="small">{t.rights.what}</div></td>
                <td><Badge tone={t.issuer === "Tessera" ? "purple" : "blue"}>{t.issuer}</Badge></td>
                <td><Address value={t.mint} n={5} href={explorerUrl(cluster, "address", t.mint)} /></td>
                <td className="num">{t.markPrice === null ? <span className="muted">n/a</span> : `$${usd(t.markPrice)}`}</td>
                <td className="num">{t.tokenPrice === null ? <span className="muted">not published</span> : `$${usd(t.tokenPrice)}`}</td>
                <td className="num">{t.discountPct === null ? <span className="muted">n/a</span> : <span className={t.discountPct > 0 ? "down" : "up"}>{t.discountPct > 0 ? "−" : "+"}{Math.abs(t.discountPct).toFixed(1)}%</span>}</td>
                <td className="num">{t.holders === null ? <span className="muted">n/a</span> : t.holders.toLocaleString("en-US")}</td>
                <td className="small">{t.feeBps === null ? <span className="muted">not read</span> : t.feeBps === 0 ? "none" : `${(t.feeBps / 100).toFixed(2)}% on every transfer`}</td>
                <td><Badge tone={t.verdict === "eligible" || t.verdict === "eligible_with_fee" ? "green" : t.verdict === "not checked" ? undefined : "amber"}>{t.verdict.replaceAll("_", " ")}</Badge>{t.escrowProven ? <div className="small">escrow proven</div> : null}</td>
                <td className="small">{t.market ? <Link className="link" href={`/trade?m=${t.market.symbol}`}>{t.market.liveSeries} Gap series · ${usd0(t.market.depthUsdc)} depth</Link> : t.tier === 3 ? "Tier 3: quote it yourself" : "not listed here"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid-2">
        <div className="card pad">
          <div className="h6">Tessera: the redemption cliff</div>
          <p className="body-sm" style={{ margin: "6px 0 0" }}>{data.tokens.find((t) => t.issuer === "Tessera")?.rights.exit ?? "Redemption needs a liquidity event, lock-up expiry, Tessera receiving proceeds and an announced start date, with no time bound; unclaimed proceeds are forfeited after the window."} A Gap here is a known price on a known date against that; the 0.2% fee is taken by the mint on every transfer, so exercise delivers the raw amount less the fee and the ticket says so.</p>
        </div>
        <div className="card pad">
          <div className="h6">PreStocks: the price of no exit</div>
          <p className="body-sm" style={{ margin: "6px 0 0" }}>{data.tokens.find((t) => t.issuer === "PreStocks")?.rights.exit ?? "A DEX where liquidity depends on finding a buyer; the mark-versus-token spread is the price of no exit."} No ownership, voting or dividend rights. The mint charges a transfer fee read above; Floors wait for fee-inclusive settlement.</p>
        </div>
      </div>
      <p className="small" style={{ marginTop: 14 }}>Issuer figures read now from rest-api.tessera.pe and prestocks.com; mint facts and verdicts from the registry run{data.generatedAt ? ` of ${new Date(data.generatedAt).toLocaleDateString("en-US", { dateStyle: "medium" })}` : ""}. Pre-IPO tokens have no Pyth feed: the issuer&apos;s own mark prices these terms and auto-exercise is off on them.</p>
    </div>
  );
}
