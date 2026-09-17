import { NextResponse, type NextRequest } from "next/server";
import { protectedBuyQuote } from "@/lib/tx-server";

export const dynamic = "force-dynamic";

/** A live Jupiter quote for `usdc` micro USDC into `mint`, for the Protected Buy desk's figures. */
export async function GET(req: NextRequest) {
  const mint = req.nextUrl.searchParams.get("mint");
  const usdc = req.nextUrl.searchParams.get("usdc");
  if (!mint || !usdc || !/^\d+$/.test(usdc)) return NextResponse.json({ error: "mint and usdc (micro) required" }, { status: 400 });
  try {
    const q = await protectedBuyQuote(mint, BigInt(usdc), Number(req.nextUrl.searchParams.get("slippageBps") ?? 50));
    return NextResponse.json({ tokensOutRaw: q.tokensOutRaw.toString(), minOutRaw: q.minOutRaw.toString(), route: q.route, priceImpactPct: q.quote.priceImpactPct, slippageBps: q.quote.slippageBps }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
