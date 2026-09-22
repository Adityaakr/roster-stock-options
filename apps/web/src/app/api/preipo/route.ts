import { NextResponse } from "next/server";
import { PREIPO_RIGHTS, prestocksTokens, readRegistry, registryPathFor, spreadToMarkPct } from "@roster/registry";
import { rosterData } from "@/lib/roster-data";

export const dynamic = "force-dynamic";

/**
 * The PreStocks desk: every token from the issuer's API right now, with every field it publishes, joined to the
 * registry's mint facts (fee, verdict, escrow proof) and to whether a market is live on this cluster. On devnet a
 * market trades a replica of the issuer's mint; the token is listed through it.
 */
export async function GET() {
  const [prestocks, roster] = await Promise.all([prestocksTokens().catch(() => null), rosterData()]);
  if (!prestocks) return NextResponse.json({ error: "prestocks.com/api did not answer; try again in a moment" }, { status: 502 });
  // Mint facts (fee, verdict) come from the mainnet inspection: the real mint is the truth. The escrow proof comes
  // from this cluster's registry, keyed by the mainnet mint a replica stands in for.
  const reg = new Map((readRegistry()?.entries ?? []).map((e) => [e.mint, e]));
  const here = new Map((readRegistry(registryPathFor(roster.cluster))?.entries ?? []).map((e) => [e.replicaOf ?? e.mint, e]));
  const live = new Map(roster.markets.map((m) => [m.replicaOf ?? m.mint, m]));
  // The best live term on each side, from every market's resident asks: a Floor's strike nearest the price, an Upside's too.
  const best = (symbol: string, side: "put" | "call") => {
    const xs = roster.ideas.filter((i) => i.market === symbol && i.side === side && i.capacity > 0);
    if (!xs.length) return null;
    const mk = roster.markets.find((m) => m.symbol === symbol)?.mark ?? 0;
    const t = xs.sort((a, b) => Math.abs(a.strike - mk) - Math.abs(b.strike - mk))[0]!;
    return { id: t.id, strike: t.strike, expiryTs: t.expiryTs, ask: t.ask, capacity: t.capacity };
  };
  const tokens = prestocks.map((t) => {
    const e = reg.get(t.mint);
    const m = live.get(t.mint);
    return {
      symbol: t.symbol, name: t.name, issuer: t.issuer, mint: t.mint, markPrice: t.markPrice, tokenPrice: t.tokenPrice, markValuation: t.markValuation, impliedValuation: t.impliedValuation, supply: t.supply, holders: t.holders, sector: t.sector, description: t.description, logo: t.logo, external: t.external,
      /** Token price against the mark, percent, signed: negative below the mark. */
      spreadPct: spreadToMarkPct(t),
      feeBps: e?.inspection.transferFee?.bps ?? null, decimals: e?.inspection.decimals ?? null, verdict: e?.inspection.verdict ?? "not checked", reason: e?.inspection.reason ?? "not in the registry run",
      escrowProven: !!(here.get(t.mint)?.escrowProof ?? e?.escrowProof), tier: here.get(t.mint)?.tier ?? e?.tier ?? null,
      market: m ? { symbol: m.symbol, mint: m.mint, liveSeries: m.liveSeries, depthUsdc: m.depthUsdc, bestAsk: m.bestAsk, mark: m.mark, sparkline: m.sparkline, markSparkline: m.markSparkline, markSpreadBps: m.markSpreadBps, vol: m.vol, volSource: m.volSource, feeBps: m.feeBps, trade: m.trade, bestFloor: best(m.symbol, "put"), bestGap: best(m.symbol, "call") } : null,
      rights: PREIPO_RIGHTS[t.issuer]
    };
  });
  return NextResponse.json({ cluster: roster.cluster, generatedAt: readRegistry()?.generatedAt ?? null, tokens }, { headers: { "cache-control": "no-store" } });
}
