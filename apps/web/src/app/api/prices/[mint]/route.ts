import { NextResponse, type NextRequest } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { services, servicesReachable } from "@/lib/services";

export const dynamic = "force-dynamic";

/** Recorded marks, feeds and basis for one market over `?days=` (default 7). */
export async function GET(req: NextRequest, ctx: { params: Promise<{ mint: string }> }) {
  const { mint } = await ctx.params;
  try { new PublicKey(mint); } catch { return NextResponse.json({ error: "not a mint" }, { status: 400 }); }
  if (!(await servicesReachable())) return NextResponse.json({ mint, mark: [], token: [], equity: [], basis: [] });
  const days = Math.min(90, Math.max(1, Number(req.nextUrl.searchParams.get("days") ?? 7) || 7));
  try {
    return NextResponse.json(await services.prices(mint, Math.floor(Date.now() / 1000) - days * 86_400), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
