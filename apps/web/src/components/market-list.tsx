"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui";
import { usd, usd0 } from "@/lib/format";
import { TIER_LABEL, type Market, type Tier } from "@/lib/model";

/*
 * Every listed market, sorted by executable depth (Part 2 addendum H): best ask, recent volatility and basis per
 * name, a search box across every listed name, and a tier filter. `compact` is the landing hero's cut.
 */
export function MarketList({ markets, selected, compact = false, hrefFor }: { markets: Market[]; selected?: string | null; compact?: boolean; hrefFor?: (m: Market) => string }) {
  const [q, setQ] = useState("");
  const [tier, setTier] = useState<Tier | 0>(0);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return markets
      .filter((m) => (tier === 0 || m.tier === tier) && (!needle || m.symbol.toLowerCase().includes(needle) || m.name.toLowerCase().includes(needle)))
      .slice(0, compact ? 6 : undefined);
  }, [markets, q, tier, compact]);
  const counts = [1, 2, 3].map((t) => markets.filter((m) => m.tier === t).length);
  const link = hrefFor ?? ((m: Market) => `/trade?m=${encodeURIComponent(m.symbol)}`);

  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap" style={{ marginBottom: 10 }}>
        <input className="field" type="search" placeholder={`Search ${markets.length} listed name${markets.length === 1 ? "" : "s"}`} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search markets" style={{ maxWidth: 280, height: 34 }} />
        {!compact ? (
          <div className="flex items-center gap-1 small" role="group" aria-label="Tier filter">
            {([0, 1, 2, 3] as const).map((t) => (
              <button key={t} className={`btn sm ${tier === t ? "primary" : "secondary"}`} onClick={() => setTier(t)} aria-pressed={tier === t}>
                {t === 0 ? "All" : `${TIER_LABEL[t]} · ${counts[t - 1]}`}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="card scroll-x">
        <table className="table" style={{ minWidth: compact ? 560 : 720 }}>
          <thead>
            <tr>
              <th>Market</th>
              <th className="num">Mark</th>
              <th className="num">Best ask</th>
              <th className="num">Executable depth</th>
              {!compact ? <th className="num">Volatility</th> : null}
              <th className="num">Basis</th>
              <th>Tier</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? <tr><td colSpan={7} className="muted">No listed market matches.</td></tr> : rows.map((m) => (
              <tr key={m.symbol} className="row-link" aria-current={selected === m.symbol ? "true" : undefined} style={selected === m.symbol ? { background: "var(--inset)" } : undefined}>
                <td>
                  <Link href={link(m)} className="flex items-center gap-2" style={{ fontWeight: 500 }}>
                    {m.symbol}
                    <span className="small muted" style={{ fontWeight: 400 }}>{m.name}</span>
                    {m.paused ? <Badge tone="amber" dot>paused</Badge> : null}
                    {m.pendingActivationTs ? <Badge tone="amber">activation pending</Badge> : null}
                  </Link>
                </td>
                <td className="num">{m.mark === null ? <span className="muted">no feed</span> : `$${usd(m.mark)}`}</td>
                <td className="num">{m.bestAsk === null ? <span className="muted">none</span> : `$${usd(m.bestAsk)}`}</td>
                <td className="num">${usd0(m.depthUsdc)}</td>
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
