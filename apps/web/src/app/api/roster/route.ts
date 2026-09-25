import { NextResponse, type NextRequest } from "next/server";
import { RECONNECTING, rosterData } from "@/lib/roster-data";

export const dynamic = "force-dynamic";

/** Everything the app screens render, in one read, for the market in `?m=` (the deepest market otherwise). */
export async function GET(req: NextRequest) {
  const m = req.nextUrl.searchParams.get("m") ?? undefined;
  const fresh = req.nextUrl.searchParams.get("fresh") === "1";
  const d = await rosterData(m, fresh);
  // The roster changes once a tick, so the edge may serve one answer for five seconds and a stale one while it
  // refreshes; a read right after a transaction and an offline answer are never cached.
  const cacheable = !fresh && d.source !== RECONNECTING;
  return NextResponse.json(d, { headers: { "cache-control": cacheable ? "public, s-maxage=5, stale-while-revalidate=30" : "no-store" } });
}
