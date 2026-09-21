"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkline } from "@/components/charts";
import { CountUp, Stagger } from "@/components/motion";
import { Badge, ErrorState, Loading } from "@/components/ui";
import { floatUsd, short, spreadLabel, TokenMark, type PreIpoTokenView } from "@/components/preipo";
import { usd, usd0, usdK } from "@/lib/format";

/*
 * The PreStocks desk (CLAUDE.md 5 First Print, docs/03-prestocks-decision.md): every token the issuer lists, live from
 * its API, with the mark, where the token trades, the signed spread between them, the valuations both imply, the
 * supply, the fee and verdict read from the mint, and the live terms where a market exists. The spread is a
 * premium or a discount to the issuer's mark, shown both ways; nothing here calls it a discount by default.
 */
type Filter = "all" | "listed" | "above" | "below";

export default function PreIpoPage() {
  const router = useRouter();
  const [data, setData] = useState<{ tokens: PreIpoTokenView[]; generatedAt: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  useEffect(() => {
    let tries = 0;
    const load = () => fetch("/api/preipo", { cache: "no-store" }).then(async (r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return (await r.json()) as { tokens: PreIpoTokenView[]; generatedAt: string | null }; }).then((j) => { setData(j); setError(null); }).catch((e: unknown) => { if (++tries < 4) setTimeout(load, 2_000); else setError(e instanceof Error ? e.message : String(e)); });
    load();
    const h = setInterval(load, 60_000);
    return () => clearInterval(h);
  }, []);
  const tokens = useMemo(() => data?.tokens ?? [], [data]);
  const shown = useMemo(() => {
    const list = tokens.filter((t) => filter === "all" || (filter === "listed" ? !!t.market : filter === "above" ? (t.spreadPct ?? 0) > 0 : (t.spreadPct ?? 0) < 0));
    // Listed first, then by the size of the token float: what can be traded here leads.
    return [...list].sort((a, b) => Number(!!b.market) - Number(!!a.market) || floatUsd(b) - floatUsd(a));
  }, [tokens, filter]);
  if (error) return <ErrorState message={`Could not read the PreStocks registry: ${error}`} next="Reload the page." />;
  if (!data) return <Loading what="the PreStocks registry" />;
  const listed = tokens.filter((t) => t.market);
  const above = tokens.filter((t) => (t.spreadPct ?? 0) > 0).length;
  const below = tokens.filter((t) => (t.spreadPct ?? 0) < 0).length;
  const float = tokens.reduce((a, t) => a + floatUsd(t), 0);
  const open = (t: PreIpoTokenView) => router.push(`/pre-ipo/${encodeURIComponent(t.symbol)}`);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>PreStocks</h1>
          <p>The stocks that have not listed yet, priced two ways: the issuer&apos;s mark for the share and where the token trades. A Gap or a Floor on each, backed before you buy, settled in the token itself.</p>
        </div>
        <div className="flex items-center gap-4 flex-wrap">
          <div className="hstat"><span>Tokens</span><b className="mono"><CountUp value={String(tokens.length)} /></b></div>
          <div className="hstat"><span>Listed here</span><b className="mono"><CountUp value={String(listed.length)} /></b></div>
          <div className="hstat"><span>Market cap, all eight</span><b className="mono">${short(float)}</b></div>
          <div className="hstat"><span>Above the mark</span><b className="mono">{above} <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>· below {below}</span></b></div>
        </div>
      </div>

      <SpreadChart tokens={tokens} onPick={open} />

      <div className="uexplore" style={{ marginTop: 18 }}>
        {([["all", "All tokens", `${tokens.length} from the issuer`], ["listed", "Listed here", `${listed.length} with a live market`], ["above", "Above the mark", `${above} trade at a premium`], ["below", "Below the mark", `${below} trade at a discount`]] as [Filter, string, string][]).map(([id, t, s]) => (
          <button key={id} className={`utile ${filter === id ? "on" : ""}`} onClick={() => setFilter(id)}><span className="t">{t}</span><span className="s">{s}</span></button>
        ))}
      </div>

      {shown.length === 0 ? <div className="card pad muted" style={{ marginTop: 14 }}>Nothing here for that filter.</div> : (
        <Stagger className="fp-grid" step={0.05}>
          {shown.map((t) => (
            <button key={t.mint} className={`card fp-card ${t.market ? "live" : ""}`} onClick={() => open(t)} data-testid="preipo-row" aria-label={`${t.symbol}, PreStocks`}>
              <div className="flex items-center justify-between">
                <TokenMark t={t} />
                {t.market ? <Badge tone="green" dot>listed</Badge> : <Badge>not listed here</Badge>}
              </div>
              <div className="fp-name"><b>{t.symbol}</b><span className="muted">{t.description ?? t.name}</span></div>
              <div className="fp-mark">
                <span>
                  <span className="mono">{t.tokenPrice === null ? "n/a" : `$${usd(t.tokenPrice)}`}</span>
                  <span className="small muted" style={{ display: "block" }}>token price</span>
                </span>
                {t.market?.sparkline?.length ? <Sparkline points={t.market.sparkline} width={84} height={26} /> : null}
              </div>
              <div className="fp-rows">
                <div><span>Issuer mark</span><b className="mono fp-tp">{t.markPrice === null ? <span className="muted">n/a</span> : <>${usd(t.markPrice)}<small className={t.spreadPct === null ? "muted" : t.spreadPct >= 0 ? "up" : "down"}>{spreadLabel(t.spreadPct)}</small></>}</b></div>
                <div><span>Valuation</span><b className="mono fp-tp">{t.impliedValuation === null ? <span className="muted">n/a</span> : <>${short(t.impliedValuation)}<small className="muted">{t.markValuation !== null ? `mark $${short(t.markValuation)}` : "implied by the token"}</small></>}</b></div>
                <div><span>Market cap</span><b className="mono fp-tp">{t.tokenPrice && t.supply ? <>${short(t.tokenPrice * t.supply)}<small className="muted">{usdK(t.supply)} tokens</small></> : <span className="muted">n/a</span>}</b></div>
                <div><span>Fee</span><b className="mono">{t.feeBps === null ? <span className="muted">not read</span> : t.feeBps === 0 ? "none" : `${(t.feeBps / 100).toFixed(2)}%`}</b></div>
                <div><span>Escrow</span><b><Badge tone={t.verdict === "eligible" || t.verdict === "eligible_with_fee" ? "green" : t.verdict === "not checked" ? undefined : "amber"}>{t.escrowProven ? "proven" : t.verdict.replaceAll("_", " ")}</Badge></b></div>
              </div>
              <div className="fp-foot">
                {t.market ? <span className="ink">{t.market.liveSeries} live series · <span className="mono">${usd0(t.market.depthUsdc)}</span> depth</span> : <span className="muted">{t.tier === 3 ? "Tier 3: quote it yourself" : "No market here yet"}</span>}
                <span className="arrow" aria-hidden>→</span>
              </div>
            </button>
          ))}
        </Stagger>
      )}

      <div className="grid-2" style={{ marginTop: 22 }}>
        <div className="card pad">
          <div className="h6">PreStocks&apos; own terms</div>
          <div className="ask-rows" style={{ marginTop: 10 }}>
            <div><span>Backing</span><b style={{ fontWeight: 400 }}>{tokens[0]?.rights.what ?? ""}</b></div>
            <div><span>Rights</span><b style={{ fontWeight: 400 }}>{tokens[0]?.rights.rights ?? ""}</b></div>
            <div><span>Exit</span><b style={{ fontWeight: 400 }}>{tokens[0]?.rights.exit ?? ""}</b></div>
            <div><span>On an IPO</span><b style={{ fontWeight: 400 }}>{tokens[0]?.rights.ipo ?? ""}</b></div>
            <div><span>On a deal</span><b style={{ fontWeight: 400 }}>{tokens[0]?.rights.mna ?? ""}</b></div>
          </div>
        </div>
        <div className="card pad">
          <div className="h6">What a contract here is</div>
          <p className="body-sm" style={{ margin: "6px 0 0" }}>A Gap is the right to buy the token at a strike through a date; a Floor the right to sell it. Both are backed in full from the moment they are sold and settle in the token itself, with no oracle in the way of an exit. The mint takes its {tokens[0]?.feeBps ? `${(tokens[0].feeBps / 100).toFixed(2)}%` : "transfer"} fee on every move, so a Gap delivers the shares less the fee and a Floor has you deliver the fee on top; the ticket states both in numbers. Prices come from where the token trades, never from the mark: the mark is what the issuer says a share is worth, and no one will pay it for the token.</p>
          <p className="body-sm" style={{ margin: "8px 0 0" }}>The spread between the two is shown as a premium or a discount. It is not a basis anyone can close, because nothing converts one into the other before a listing.</p>
        </div>
      </div>
      <p className="small" style={{ marginTop: 14 }}>Figures read now from prestocks.com/api and refreshed every minute; logos are the issuer&apos;s. Mint facts and verdicts from the registry run{data.generatedAt ? ` of ${new Date(data.generatedAt).toLocaleDateString("en-US", { dateStyle: "medium" })}` : ""}. PreStocks tokens have no Pyth feed: the token price prices these terms, recent volatility is measured from the prices the services record, and auto-exercise is off on them.</p>
    </div>
  );
}

/** Where each token trades against its mark, as one picture: bars either side of the mark, sorted. */
function SpreadChart({ tokens, onPick }: { tokens: PreIpoTokenView[]; onPick: (t: PreIpoTokenView) => void }) {
  const rows = tokens.filter((t) => t.spreadPct !== null).sort((a, b) => (b.spreadPct ?? 0) - (a.spreadPct ?? 0));
  if (!rows.length) return null;
  const max = Math.max(5, ...rows.map((t) => Math.abs(t.spreadPct ?? 0)));
  return (
    <section className="card spread" style={{ marginTop: 22 }}>
      <div className="spread-head">
        <div>
          <div className="h6">Where the token trades against the mark</div>
          <div className="small muted" style={{ marginTop: 2 }}>The issuer&apos;s mark is the centre line. A bar to the right is a token paying a premium for access; to the left, a discount for the lack of it. Both directions exist today.</div>
        </div>
        <div className="small muted mono">±{max.toFixed(0)}%</div>
      </div>
      <div className="spread-rows">
        {rows.map((t) => {
          const v = t.spreadPct ?? 0;
          const w = (Math.abs(v) / max) * 50;
          return (
            <button key={t.mint} className="spread-row" onClick={() => onPick(t)} aria-label={`${t.symbol} ${spreadLabel(v)}`}>
              <span className="flex items-center gap-2" style={{ minWidth: 0 }}><TokenMark t={t} size={22} /><b>{t.symbol}</b></span>
              <span className="spread-track" aria-hidden>
                <i className="mid" />
                <i className={`bar ${v >= 0 ? "up" : "down"}`} style={v >= 0 ? { left: "50%", width: `${w}%` } : { right: "50%", width: `${w}%` }} />
              </span>
              <span className={`mono ${v >= 0 ? "up" : "down"}`} style={{ textAlign: "right" }}>{spreadLabel(v)}</span>
              <span className="small muted mono hide-sm" style={{ textAlign: "right" }}>${usd(t.tokenPrice ?? 0)} vs ${usd(t.markPrice ?? 0)}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
