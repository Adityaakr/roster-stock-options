import { NextResponse, type NextRequest } from "next/server";
import { readRegistry } from "@roster/registry";
import { rosterData } from "@/lib/roster-data";

export const dynamic = "force-dynamic";

/**
 * Every wrapper of one stock the registry knows (`?underlying=AAPL`), or all of them grouped: issuer, mint, verdict
 * and reason, holders, feed, escrow proof, and whether a market is live on this cluster with its depth.
 */
export async function GET(req: NextRequest) {
  const want = req.nextUrl.searchParams.get("underlying")?.toUpperCase() ?? null;
  const [reg, roster] = await Promise.all([readRegistry(), rosterData()]);
  // A market on this cluster may trade a replica of the registry's mint; it is the same listing.
  const live = new Map(roster.markets.flatMap((m) => [[m.mint, m] as const, ...(m.replicaOf ? [[m.replicaOf, m] as const] : [])]));
  const groups = new Map<string, unknown[]>();
  for (const e of reg?.entries ?? []) {
    const u = e.underlyingSymbol?.toUpperCase();
    if (!u || (want && u !== want)) continue;
    const m = live.get(e.mint);
    const row = {
      symbol: e.symbol, name: e.name, issuer: e.wrapper, mint: e.mint, tier: e.tier, holders: e.holders, decimals: e.inspection.decimals,
      verdict: e.inspection.verdict, reason: e.inspection.reason, feeBps: e.inspection.transferFee?.bps ?? 0, pausable: !!e.inspection.pausable, permanentDelegate: !!e.inspection.permanentDelegate,
      tokenFeed: e.feeds.tokenFeed?.symbol ?? null, escrowProven: !!e.escrowProof, logo: e.logo,
      market: m ? { symbol: m.symbol, mark: m.mark, bestAsk: m.bestAsk, depthUsdc: m.depthUsdc, liveSeries: m.liveSeries, tier: m.tier } : null,
      status: m ? "listed" : e.inspection.verdict === "restricted_wrapper" ? "restricted" : e.inspection.verdict === "ineligible" ? "ineligible" : !e.feeds.tokenFeed ? "no Pyth feed" : !e.escrowProof ? "escrow not proven" : "eligible, not listed on this cluster"
    };
    groups.set(u, [...(groups.get(u) ?? []), row]);
  }
  return NextResponse.json({ underlyings: [...groups.entries()].map(([underlying, wrappers]) => ({ underlying, wrappers })) }, { headers: { "cache-control": "no-store" } });
}
