import { NextResponse } from "next/server";
import { PREIPO_RIGHTS, prestocksTokens, readRegistry, tesseraTokens } from "@roster/registry";
import { rosterData } from "@/lib/roster-data";

export const dynamic = "force-dynamic";

/**
 * First Print registry: every Tessera and PreStocks token from the issuers' APIs right now, joined to the registry's
 * mint facts (fee, verdict, escrow proof) and to whether a market is live on this cluster.
 */
export async function GET() {
  const [tessera, prestocks, roster] = await Promise.all([tesseraTokens().catch(() => []), prestocksTokens().catch(() => []), rosterData()]);
  const reg = new Map((readRegistry()?.entries ?? []).map((e) => [e.mint, e]));
  const live = new Map(roster.markets.map((m) => [m.mint, m]));
  const tokens = [...tessera, ...prestocks].map((t) => {
    const e = reg.get(t.mint);
    const m = live.get(t.mint);
    return {
      symbol: t.symbol, name: t.name, issuer: t.issuer, mint: t.mint, markPrice: t.markPrice, tokenPrice: t.tokenPrice, holders: t.holders, sector: t.sector, logo: t.logo, external: t.external,
      discountPct: t.markPrice && t.tokenPrice ? ((t.markPrice - t.tokenPrice) / t.markPrice) * 100 : null,
      feeBps: e?.inspection.transferFee?.bps ?? null, decimals: e?.inspection.decimals ?? null, verdict: e?.inspection.verdict ?? "not checked", reason: e?.inspection.reason ?? "not in the registry run",
      escrowProven: !!e?.escrowProof, tier: e?.tier ?? null,
      market: m ? { symbol: m.symbol, liveSeries: m.liveSeries, depthUsdc: m.depthUsdc, bestAsk: m.bestAsk } : null,
      rights: PREIPO_RIGHTS[t.issuer]
    };
  });
  return NextResponse.json({ cluster: roster.cluster, generatedAt: readRegistry()?.generatedAt ?? null, tokens }, { headers: { "cache-control": "no-store" } });
}
