import { NextResponse, type NextRequest } from "next/server";
import { services, servicesReachable } from "@/lib/services";

export const dynamic = "force-dynamic";

/** Indexed program events naming an account (a wallet, a vault), newest first. */
export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get("account") ?? "";
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) return NextResponse.json({ error: "account required" }, { status: 400 });
  if (!(await servicesReachable())) return NextResponse.json([]);
  try {
    return NextResponse.json(await services.events({ wallet, limit: 60 }));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
