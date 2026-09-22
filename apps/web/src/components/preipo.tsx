"use client";

import { useState } from "react";
import { usd0 } from "@/lib/format";

/** The PreStocks desk's shared shape and marks: the `/api/preipo` payload, the issuer's logo, the spread label. */
export interface PreIpoTokenView {
  symbol: string; name: string; issuer: "PreStocks"; mint: string; markPrice: number | null; tokenPrice: number | null; markValuation: number | null; impliedValuation: number | null; supply: number | null; holders: number | null; sector: string | null; description: string | null; logo: string | null; external: string | null;
  spreadPct: number | null; feeBps: number | null; decimals: number | null; verdict: string; reason: string; escrowProven: boolean; tier: number | null;
  market: { symbol: string; mint: string; liveSeries: number; depthUsdc: number; bestAsk: number | null; mark: number; sparkline: [number, number][]; markSparkline: [number, number][]; markSpreadBps: number | null; vol: number; volSource: string; feeBps: number; trade: { pool: string; poolAddress: string; liquidityUsd: number | null; volume24hUsd: number | null; change24hPct: number | null; change7dPct: number | null; change30dPct: number | null; daily: [number, number][]; days: number } | null; bestFloor: { id: string; strike: number; expiryTs: number; ask: number; capacity: number } | null; bestGap: { id: string; strike: number; expiryTs: number; ask: number; capacity: number } | null } | null;
  rights: { what: string; rights: string; exit: string; ipo: string; mna: string };
}
export function spreadLabel(pct: number | null): string {
  if (pct === null) return "n/a";
  // Within a twentieth of a percent the token is at the mark; a signed zero would claim a direction it does not have.
  if (Math.abs(pct) < 0.05) return "at the mark";
  return `${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(1)}% ${pct >= 0 ? "above" : "below"}`;
}
export function floatUsd(t: PreIpoTokenView): number {
  return t.tokenPrice && t.supply ? t.tokenPrice * t.supply : 0;
}
/** $1.43T, $84.6B, $12.3M. */
export function short(v: number): string {
  if (v >= 1e12) return `${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  return usd0(v);
}

/** The issuer's logo, which PreStocks publishes for every token; a monogram if it fails to load. */
export function TokenMark({ t, size = 44 }: { t: Pick<PreIpoTokenView, "symbol" | "logo">; size?: number }) {
  const [broken, setBroken] = useState(false);
  if (t.logo && !broken) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={t.logo} alt="" className="fp-logo" style={{ width: size, height: size, borderRadius: Math.round(size * 0.23) }} onError={() => setBroken(true)} />;
  }
  return <span aria-hidden className="fp-logo mono mono-p" style={{ width: size, height: size, fontSize: Math.round(size * 0.34), borderRadius: Math.round(size * 0.23) }}>{t.symbol.slice(0, 2).toUpperCase()}</span>;
}
