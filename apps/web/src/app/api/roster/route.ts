import { NextResponse, type NextRequest } from "next/server";
import { rosterData } from "@/lib/roster-data";

export const dynamic = "force-dynamic";

/** Everything the app screens render, in one read, for the market in `?m=` (the deepest market otherwise). */
export async function GET(req: NextRequest) {
  const m = req.nextUrl.searchParams.get("m") ?? undefined;
  return NextResponse.json(await rosterData(m), { headers: { "cache-control": "no-store" } });
}
