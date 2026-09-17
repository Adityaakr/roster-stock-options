import { NextResponse } from "next/server";
import { rosterData } from "@/lib/roster-data";

export const dynamic = "force-dynamic";

export async function GET() {
  const d = await rosterData();
  return NextResponse.json({ cluster: d.cluster, label: d.clusterLabel, programDeployed: d.programDeployed, rpcReachable: true, explorer: null });
}
