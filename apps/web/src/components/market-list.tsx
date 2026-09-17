"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Sparkline } from "@/components/charts";
import { Badge } from "@/components/ui";
import { usd, usd0 } from "@/lib/format";
import { TIER_LABEL, type Market, type Tier } from "@/lib/model";

/*
 * Every listed market, sorted by executable depth (Part 2 addendum H): mark and its move, a day of recorded marks,
 * best ask, depth against the deepest name, volatility and basis, tier. A row opens the market's own page.
 * `compact` is the landing hero's cut; the full list scrolls inside its own panel with a sticky header.
 */
export function MarketLogo({ m, size = 28 }: { m: Pick<Market, "symbol" | "logo">; size?: number }) {
  const [broken, setBroken] = useState(false);
  if (m.logo && !broken) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={m.logo} alt="" width={size} height={size} onError={() => setBroken(true)} style={{ width: size, height: size, borderRadius: 9999, objectFit: "cover", background: "var(--surface)", flex: "none" }} />;
  }
  return <span aria-hidden className="mono" style={{ width: size, height: size, borderRadius: 9999, background: "var(--ink)", color: "var(--paper)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: Math.round(size * 0.36), flex: "none" }}>{m.symbol.replace(/x$/, "").slice(0, 2).toUpperCase()}</span>;
}

export function MarketList({ markets, selected, compact = false, hrefFor, maxHeight }: { markets: Market[]; selected?: string | null; compact?: boolean; hrefFor?: (m: Market) => string; maxHeight?: number }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [tier, setTier] = useState<Tier | 0>(0);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return markets
      .filter((m) => (tier === 0 || m.tier === tier) && (!needle || m.symbol.toLowerCase().includes(needle) || m.name.toLowerCase().includes(needle)))
      .slice(0, compact ? 6 : undefined);
  }, [markets, q, tier, compact]);
  const counts = [1, 2, 3].map((t) => markets.filter((m) => m.tier === t).length);
  const maxDepth = Math.max(1, ...markets.map((m) => m.depthUsdc));
  const link = hrefFor ?? ((m: Market) => `/markets/${encodeURIComponent(m.symbol)}`);
  const go = (m: Market) => router.push(link(m));

  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap" style={{ marginBottom: 12 }}>
        <input className="field" type="search" placeholder={`Search ${markets.length} listed name${markets.length === 1 ? "" : "s"}`} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search markets" style={{ maxWidth: 280, height: 36 }} />
        {!compact ? (
          <div className="seg" role="group" aria-label="Tier filter">
            {([0, 1, 2, 3] as const).map((t) => (
              <button key={t} className={tier === t ? "on" : ""} onClick={() => setTier(t)} aria-pressed={tier === t}>
                {t === 0 ? `All · ${markets.length}` : `${TIER_LABEL[t]} · ${counts[t - 1]}`}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="card mlist" style={maxHeight ? { maxHeight, overflowY: "auto" } : undefined}>
        <table className="table mtable" style={{ minWidth: compact ? 640 : 860 }}>
          <thead>
            <tr>
              <th>Market</th>
              <th className="num">Mark</th>
              <th className="num" title="Over the marks recorded on this cluster, up to a day">Change</th>
              {!compact ? <th>Recorded</th> : null}
              <th className="num">Best ask</th>
              <th style={{ minWidth: 180 }}>Executable depth</th>
              {!compact ? <th className="num">Volatility</th> : null}
              <th className="num">Basis</th>
              <th>Tier</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? <tr><td colSpan={9} className="muted">No listed market matches.</td></tr> : rows.map((m) => (
              <tr key={m.symbol} className="row-link" data-testid="market-row" onClick={() => go(m)} tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") go(m); }} aria-current={selected === m.symbol ? "true" : undefined}>
                <td>
                  <div className="flex items-center gap-3" style={{ minWidth: 0 }}>
                    <MarketLogo m={m} />
                    <div style={{ minWidth: 0 }}>
                      <div className="flex items-center gap-2" style={{ fontWeight: 500 }}>
                        <Link href={link(m)} onClick={(e) => e.stopPropagation()}>{m.symbol}</Link>
                        {m.paused ? <Badge tone="amber" dot>paused</Badge> : null}
                        {m.pendingActivationTs ? <Badge tone="amber">activation pending</Badge> : null}
                      </div>
                      <div className="small muted" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.name}</div>
                    </div>
                  </div>
                </td>
                <td className="num">{m.mark === null ? <span className="muted">no feed</span> : `$${usd(m.mark)}`}</td>
                <td className={`num ${m.changePct === null ? "muted" : m.changePct >= 0 ? "up" : "down"}`}>{m.changePct === null ? "–" : `${m.changePct >= 0 ? "+" : "−"}${Math.abs(m.changePct).toFixed(2)}%`}</td>
                {!compact ? <td><Sparkline points={m.sparkline} /></td> : null}
                <td className="num">{m.bestAsk === null ? <span className="muted">none</span> : `$${usd(m.bestAsk)}`}</td>
                <td>
                  <div className="depth"><span className="depth-bar"><i style={{ width: `${Math.max(2, (m.depthUsdc / maxDepth) * 100)}%` }} /></span><span className="mono">${usd0(m.depthUsdc)}</span></div>
                </td>
                {!compact ? <td className="num">{(m.vol * 100).toFixed(0)}% <span className="small muted">{m.volSource === "fixture" ? "fixture" : m.volSource.includes("floor") ? "floor" : "realised"}</span></td> : null}
                <td className="num">{m.basisBps === null ? <span className="muted">n/a</span> : `${m.basisBps >= 0 ? "+" : ""}${m.basisBps} bps`}</td>
                <td><Badge tone={m.tier === 1 ? "green" : m.tier === 2 ? "blue" : undefined}>{TIER_LABEL[m.tier]}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
