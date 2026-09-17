import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { walletPositions } from "@/lib/roster-data";

export const dynamic = "force-dynamic";

/** A wallet's positions across every market, from the indexer. */
export async function GET(_req: Request, ctx: { params: Promise<{ wallet: string }> }) {
  const { wallet } = await ctx.params;
  try {
    new PublicKey(wallet);
  } catch {
    return NextResponse.json({ error: "not a wallet address" }, { status: 400 });
  }
  try {
    return NextResponse.json(await walletPositions(wallet), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
