/*
 * The launch set (Part 2 section 2), resolved from the xStocks Assets API at every start; nothing here is a
 * hard-coded mint. The full registry job with tokens.xyz tiers and eligibility verdicts is P7; this is the subset the
 * fork and the submission build list.
 */
import { PublicKey } from "@solana/web3.js";

import { listable, readRegistry, TIER1_SET, xstocksQuote } from "@roster/registry";

export const LAUNCH_SET = TIER1_SET;
export const XSTOCKS_API = "https://api.xstocks.fi/api/v2";

export interface LaunchEntry {
  symbol: string;
  name: string;
  mint: PublicKey;
  decimals: number;
  tier: number;
}

/**
 * The markets the services run: every proven entry of fixtures/registry/registry.json (scripts/eligibility.ts then
 * scripts/list-markets.ts), or `LAUNCH_SYMBOLS` resolved from the xStocks API when the registry is absent.
 */
export async function launchSet(): Promise<LaunchEntry[]> {
  const symbols = process.env.LAUNCH_SYMBOLS?.split(",").map((s) => s.trim()).filter(Boolean);
  const reg = readRegistry();
  if (reg && !symbols) return listable(reg).map((e) => ({ symbol: e.symbol, name: e.name, mint: new PublicKey(e.mint), decimals: e.inspection.decimals, tier: e.tier }));
  const wanted = symbols ?? LAUNCH_SET;
  const fromRegistry = reg ? new Map(reg.entries.map((e) => [e.symbol, e])) : new Map();
  const out: LaunchEntry[] = [];
  for (const s of wanted) {
    const r = fromRegistry.get(s);
    if (r) out.push({ symbol: r.symbol, name: r.name, mint: new PublicKey(r.mint), decimals: r.inspection.decimals, tier: r.tier });
    else out.push(...(await resolveLaunchSet([s])));
  }
  return out;
}

/** The issuer's spot quote, the fork-only stand-in for a keyed Hermes read and the display mark elsewhere. */
export { xstocksQuote };

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
    out.push({ symbol, name: j.name ?? symbol, mint: new PublicKey(dep.address), decimals: dep.decimals ?? 8, tier: TIER1_SET.includes(symbol) ? 1 : 2 });
  }
  return out;
}
