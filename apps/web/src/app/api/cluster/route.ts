import { NextResponse } from "next/server";
import { rpcHosts } from "@roster/core";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

const EXPLORER: Record<string, string | null> = {
  mainnet: "https://solscan.io/{path}",
  devnet: "https://solscan.io/{path}?cluster=devnet",
  fork: null,
  fixture: null
};
const LABEL: Record<string, string> = { fixture: "Offline", fork: "Fork", devnet: "Devnet", mainnet: "Mainnet" };

/** Which cluster the app is reading, from the services' health answer alone: a page never waits on the roster for this. */
export async function GET() {
  const built = process.env.NEXT_PUBLIC_CLUSTER ?? "fixture";
  try {
    const h = await services.health();
    const cluster = h.cluster === "fork" ? "fork" : h.cluster === "devnet" ? "devnet" : "mainnet";
    return NextResponse.json(
      { cluster, label: LABEL[cluster], programDeployed: !!h.program, rpcReachable: true, explorer: EXPLORER[cluster] ?? null, blocked: h.blocked, pythKeyed: !!h.hermesKeyed, rpc: rpcHosts(process.env.RPC_URL ?? "", process.env.NEXT_PUBLIC_CLUSTER ?? null) },
      { headers: { "cache-control": "public, s-maxage=10, stale-while-revalidate=60" } }
    );
  } catch {
    const cluster = built in LABEL ? built : "fixture";
    return NextResponse.json({ cluster, label: LABEL[cluster], programDeployed: cluster !== "fixture", rpcReachable: false, explorer: EXPLORER[cluster] ?? null, blocked: null }, { headers: { "cache-control": "no-store" } });
  }
}
