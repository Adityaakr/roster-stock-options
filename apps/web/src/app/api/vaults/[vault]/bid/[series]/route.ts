import { NextResponse } from "next/server";
import { services, servicesReachable } from "@/lib/services";

export const dynamic = "force-dynamic";

/** The vault's standing bid on one series, or null. */
export async function GET(_req: Request, ctx: { params: Promise<{ vault: string; series: string }> }) {
  const { vault, series } = await ctx.params;
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(vault) || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(series)) return NextResponse.json({ error: "bad address" }, { status: 400 });
  if (!(await servicesReachable())) return NextResponse.json(null);
  try {
    return NextResponse.json(await services.vaultBid(vault, series));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
