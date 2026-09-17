/*
 * The launch set (Part 2 section 2), resolved from the xStocks Assets API at every start; nothing here is a
 * hard-coded mint. The full registry job with tokens.xyz tiers and eligibility verdicts is P7; this is the subset the
 * fork and the submission build list.
 */
import { PublicKey } from "@solana/web3.js";

export const LAUNCH_SET = ["NVDAx", "TSLAx", "SPYx"];
export const TIER2_SET = ["AAPLx", "MSFTx", "GOOGLx", "AMZNx", "METAx", "CRCLx", "MSTRx", "QQQx"];
export const XSTOCKS_API = "https://api.xstocks.fi/api/v2";

export interface LaunchEntry {
  symbol: string;
  name: string;
  mint: PublicKey;
  decimals: number;
}

export async function resolveLaunchSet(symbols: string[]): Promise<LaunchEntry[]> {
  const out: LaunchEntry[] = [];
  for (const symbol of symbols) {
    const res = await fetch(`${XSTOCKS_API}/public/assets/${symbol}`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      console.warn(`[registry] ${symbol}: xStocks API ${res.status}, skipped`);
      continue;
    }
    const j = (await res.json()) as { name?: string; deployments?: { network: string; address: string; decimals?: number }[] };
    const dep = j.deployments?.find((d) => d.network === "Solana");
    if (!dep) {
      console.warn(`[registry] ${symbol}: no Solana deployment, skipped`);
      continue;
    }
    out.push({ symbol, name: j.name ?? symbol, mint: new PublicKey(dep.address), decimals: dep.decimals ?? 8 });
  }
  return out;
}
