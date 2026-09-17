import { NextResponse, type NextRequest } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { protectedBuyQuote } from "@/lib/tx-server";
import { rosterData } from "@/lib/roster-data";

export const dynamic = "force-dynamic";

/** A live Jupiter quote for `usdc` micro USDC into `mint`, for the Protected Buy desk's figures. */
export async function GET(req: NextRequest) {
  const mint = req.nextUrl.searchParams.get("mint");
  const usdc = req.nextUrl.searchParams.get("usdc");
  if (!mint || !usdc || !/^\d{1,15}$/.test(usdc)) return NextResponse.json({ error: "mint and usdc (micro) required" }, { status: 400 });
  try { new PublicKey(mint); } catch { return NextResponse.json({ error: "mint is not a valid address" }, { status: 400 }); }
  // Only listed markets are quoted: this route is not a general Jupiter proxy.
  const listed = (await rosterData()).markets.some((m) => m.mint === mint);
  if (!listed) return NextResponse.json({ error: "mint is not a listed market" }, { status: 404 });
  const slippage = Math.min(500, Math.max(0, Number(req.nextUrl.searchParams.get("slippageBps") ?? 50) || 50));
  try {
    const q = await protectedBuyQuote(mint, BigInt(usdc), slippage);
    return NextResponse.json({ tokensOutRaw: q.tokensOutRaw.toString(), minOutRaw: q.minOutRaw.toString(), route: q.route, priceImpactPct: q.quote.priceImpactPct, slippageBps: q.quote.slippageBps }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
