import { NextResponse } from "next/server";
import { rosterData } from "@/lib/roster-data";

export const dynamic = "force-dynamic";

const EXPLORER: Record<string, string | null> = {
  mainnet: "https://solscan.io/{path}",
  devnet: "https://solscan.io/{path}?cluster=devnet",
  fork: null,
  fixture: null
};

export async function GET() {
  const d = await rosterData();
  return NextResponse.json({ cluster: d.cluster, label: d.clusterLabel, programDeployed: d.programDeployed, rpcReachable: d.cluster !== "fixture", explorer: EXPLORER[d.cluster] ?? null, blocked: d.blocked });
}
