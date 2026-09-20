import { NextResponse } from "next/server";
import { services, servicesReachable } from "@/lib/services";

export const dynamic = "force-dynamic";

/** A wallet's shares and queues in one vault. */
export async function GET(_req: Request, ctx: { params: Promise<{ vault: string; wallet: string }> }) {
  const { vault, wallet } = await ctx.params;
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(vault) || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) return NextResponse.json({ error: "bad address" }, { status: 400 });
  if (!(await servicesReachable())) return NextResponse.json({ shares: "0", queuedDepositRaw: "0", queuedDepositEpoch: null, queuedWithdrawShares: "0", queuedWithdrawEpoch: null });
  try {
    return NextResponse.json(await services.vaultPosition(vault, wallet));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
