"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CountUp, Stagger } from "@/components/motion";
import { Badge, ErrorState, Loading } from "@/components/ui";
import { usd, usd0 } from "@/lib/format";

/*
 * First Print (CLAUDE.md 5): the registry of Tessera and PreStocks tokens, live from the issuers, one card per token
 * with the rights profile, mark versus token price and the implied discount, the transfer fee read from the mint, the
 * verdict, and the funded-exit terms where a market is live. The redemption cliff and the price of no exit below.
 */
interface Token {
  symbol: string; name: string; issuer: "Tessera" | "PreStocks"; mint: string; markPrice: number | null; tokenPrice: number | null; holders: number | null; sector: string | null; logo: string | null; external: string | null;
  discountPct: number | null; feeBps: number | null; decimals: number | null; verdict: string; reason: string; escrowProven: boolean; tier: number | null;
  market: { symbol: string; liveSeries: number; depthUsdc: number; bestAsk: number | null } | null;
  rights: { what: string; rights: string; exit: string };
}
type Filter = "all" | "Tessera" | "PreStocks" | "listed";

export default function PreIpoPage() {
  const router = useRouter();
  const [data, setData] = useState<{ tokens: Token[]; generatedAt: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  useEffect(() => {
    fetch("/api/preipo", { cache: "no-store" }).then(async (r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return (await r.json()) as { tokens: Token[]; generatedAt: string | null }; }).then(setData).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  const tokens = useMemo(() => data?.tokens ?? [], [data]);
  const shown = useMemo(() => {
    const list = tokens.filter((t) => filter === "all" || (filter === "listed" ? !!t.market : t.issuer === filter));
    // Listed first, then by holders, then by mark: what can be traded here leads.
    return [...list].sort((a, b) => Number(!!b.market) - Number(!!a.market) || (b.holders ?? 0) - (a.holders ?? 0) || (b.markPrice ?? 0) - (a.markPrice ?? 0));
  }, [tokens, filter]);
  if (error) return <ErrorState message={`Could not read the pre-IPO registries: ${error}`} next="Reload the page." />;
  if (!data) return <Loading what="the registries" />;
  const listed = tokens.filter((t) => t.market);
  const holders = tokens.reduce((a, t) => a + (t.holders ?? 0), 0);
  const discounts = tokens.filter((t) => t.discountPct !== null).map((t) => t.discountPct!);
  const avgDiscount = discounts.length ? discounts.reduce((a, b) => a + b, 0) / discounts.length : null;
  const open = (t: Token) => router.push(`/pre-ipo/${encodeURIComponent(t.symbol)}`);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>First Print</h1>
          <p>Funded exits on the assets with no exit at all. A known price on a known date for tokens whose market has never opened, live from Tessera and PreStocks.</p>
        </div>
        <div className="flex items-center gap-4 flex-wrap">
          <div className="hstat"><span>Tokens tracked</span><b className="mono"><CountUp value={String(tokens.length)} /></b></div>
          <div className="hstat"><span>Listed here</span><b className="mono"><CountUp value={String(listed.length)} /></b></div>
          <div className="hstat"><span>Holders, Tessera</span><b className="mono"><CountUp value={holders.toLocaleString("en-US")} /></b></div>
          <div className="hstat"><span>Token vs mark, PreStocks</span><b className="mono">{avgDiscount === null ? "n/a" : `${avgDiscount > 0 ? "−" : "+"}${Math.abs(avgDiscount).toFixed(1)}%`}</b></div>
        </div>
      </div>

      <div className="uexplore" style={{ marginTop: 22 }}>
        {([["all", "All tokens", `${tokens.length} tracked`], ["listed", "Listed here", `${listed.length} with a live market`], ["Tessera", "Tessera", "loan participation rights"], ["PreStocks", "PreStocks", "SPV exposure, backed 1:1"]] as [Filter, string, string][]).map(([id, t, s]) => (
          <button key={id} className={`utile ${filter === id ? "on" : ""}`} onClick={() => setFilter(id)}><span className="t">{t}</span><span className="s">{s}</span></button>
        ))}
      </div>

      {shown.length === 0 ? <div className="card pad muted" style={{ marginTop: 14 }}>Nothing here for that filter.</div> : (
        <Stagger className="fp-grid" step={0.05}>
          {shown.map((t) => (
            <button key={t.mint} className={`card fp-card ${t.market ? "live" : ""}`} onClick={() => open(t)} data-testid="preipo-row" aria-label={`${t.symbol}, ${t.issuer}`}>
              <div className="flex items-center justify-between">
                <TokenMark t={t} />
                <Badge tone={t.issuer === "Tessera" ? "purple" : "blue"}>{t.issuer}</Badge>
              </div>
              <div className="fp-name"><b>{t.symbol}</b><span className="muted">{t.sector ?? (t.issuer === "PreStocks" ? "SPV exposure, backed 1:1" : t.rights.what)}</span></div>
              <div className="fp-mark">
                <span className="mono">{t.markPrice === null ? "n/a" : `$${usd(t.markPrice)}`}</span>
                <span className="small muted">issuer mark</span>
              </div>
              <div className="fp-rows">
                <div><span>Token price</span><b className="mono fp-tp">{t.tokenPrice === null ? <span className="muted">not published</span> : <>${usd(t.tokenPrice)}<small className={t.discountPct !== null && t.discountPct > 0 ? "down" : "up"}>{t.discountPct === null ? "" : `${t.discountPct > 0 ? "−" : "+"}${Math.abs(t.discountPct).toFixed(1)}% vs mark`}</small></>}</b></div>
                <div><span>Holders</span><b className="mono">{t.holders === null ? <span className="muted">n/a</span> : t.holders.toLocaleString("en-US")}</b></div>
                <div><span>Transfer fee</span><b className="mono">{t.feeBps === null ? <span className="muted">not read</span> : t.feeBps === 0 ? "none" : `${(t.feeBps / 100).toFixed(2)}%`}</b></div>
                <div><span>Escrow</span><b><Badge tone={t.verdict === "eligible" || t.verdict === "eligible_with_fee" ? "green" : t.verdict === "not checked" ? undefined : "amber"}>{t.escrowProven ? "proven" : t.verdict.replaceAll("_", " ")}</Badge></b></div>
              </div>
              <div className="fp-foot">
                {t.market ? <span className="ink">{t.market.liveSeries} Gap series · <span className="mono">${usd0(t.market.depthUsdc)}</span> depth</span> : <span className="muted">{t.tier === 3 ? "Tier 3: quote it yourself" : "No market here yet"}</span>}
                <span className="arrow" aria-hidden>→</span>
              </div>
            </button>
          ))}
        </Stagger>
      )}

      <div className="grid-2" style={{ marginTop: 22 }}>
        <div className="card pad">
          <div className="h6">Tessera: the redemption cliff</div>
          <p className="body-sm" style={{ margin: "6px 0 0" }}>{tokens.find((t) => t.issuer === "Tessera")?.rights.exit ?? "Redemption needs a liquidity event, lock-up expiry, Tessera receiving proceeds and an announced start date, with no time bound; unclaimed proceeds are forfeited after the window."} A Gap here is a known price on a known date against that; the 0.2% fee is taken by the mint on every transfer, so exercise delivers the raw amount less the fee and the ticket says so.</p>
        </div>
        <div className="card pad">
          <div className="h6">PreStocks: the price of no exit</div>
          <p className="body-sm" style={{ margin: "6px 0 0" }}>{tokens.find((t) => t.issuer === "PreStocks")?.rights.exit ?? "A DEX where liquidity depends on finding a buyer; the mark-versus-token spread is the price of no exit."} No ownership, voting or dividend rights. The mint charges the transfer fee shown on each card; Floors wait for fee-inclusive settlement.</p>
        </div>
      </div>
      <p className="small" style={{ marginTop: 14 }}>Issuer figures read now from rest-api.tessera.pe and prestocks.com; logos are the issuer&apos;s own where it publishes one. Mint facts and verdicts from the registry run{data.generatedAt ? ` of ${new Date(data.generatedAt).toLocaleDateString("en-US", { dateStyle: "medium" })}` : ""}. Pre-IPO tokens have no Pyth feed: the issuer&apos;s own mark prices these terms and auto-exercise is off on them.</p>
    </div>
  );
}

/** The issuer's logo where it publishes one (PreStocks does), otherwise a monogram. */
function TokenMark({ t }: { t: Token }) {
  const [broken, setBroken] = useState(false);
  if (t.logo && !broken) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={t.logo} alt="" className="fp-logo" onError={() => setBroken(true)} />;
  }
  return <span aria-hidden className={`fp-logo mono mono-${t.issuer === "Tessera" ? "t" : "p"}`}>{t.symbol.replace(/^t/, "").slice(0, 2).toUpperCase()}</span>;
}

