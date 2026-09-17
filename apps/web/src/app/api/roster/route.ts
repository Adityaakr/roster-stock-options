import { NextResponse } from "next/server";
import { rosterData } from "@/lib/roster-data";

export const dynamic = "force-dynamic";

/** Everything the app screens render, in one read. P2 swaps the source for the indexer and the executable-protection endpoint. */
export async function GET() {
  return NextResponse.json(await rosterData(), { headers: { "cache-control": "no-store" } });
}
