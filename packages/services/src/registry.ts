/*
 * The launch set (Part 2 section 2), resolved from the xStocks Assets API at every start; nothing here is a
 * hard-coded mint. The full registry job with tokens.xyz tiers and eligibility verdicts is P7; this is the subset the
 * fork and the submission build list.
 */
import { PublicKey } from "@solana/web3.js";

import { jupiterPrice, listable, marketSnapshots, prestocksTokens, readRegistry, registryPathFor, tesseraTokens, tokensApiKeyed, TIER1_SET, xstocksQuote, type PreIpoToken } from "@roster/registry";

export const LAUNCH_SET = TIER1_SET;
export const XSTOCKS_API = "https://api.xstocks.fi/api/v2";

export interface LaunchEntry {
  symbol: string;
  name: string;
  mint: PublicKey;
  decimals: number;
  tier: number;
  wrapper: "xStock" | "Ondo" | "Tessera" | "PreStocks";
  underlyingSymbol: string | null;
  /** Transfer fee on the mint, basis points; the quoter sizes asks under the deposit by this much. */
  feeBps: number;
  /** Devnet only: the mainnet mint whose price this replica takes (docs/DEVNET.md). Null everywhere else. */
  replicaOf: string | null;
  /** The issuer's logo where the registry has one, and how many wrappers of the same stock the registry knows. */
  logo: string | null;
  wrappersOfUnderlying: number;
}

/**
 * The markets the services run: every proven entry of fixtures/registry/registry.json (scripts/eligibility.ts then
 * scripts/list-markets.ts), or `LAUNCH_SYMBOLS` resolved from the xStocks API when the registry is absent.
 */
export async function launchSet(cluster = "fork"): Promise<LaunchEntry[]> {
  const symbols = process.env.LAUNCH_SYMBOLS?.split(",").map((s) => s.trim()).filter(Boolean);
  const reg = readRegistry(registryPathFor(cluster));
  // The app used to read the registry file itself, which is the wrong place for it to live: the file belongs to a
  // cluster, and a deployment may not ship it at all. The services know which registry they are running, so the
  // issuer's logo and the wrapper count travel with the market.
  const wrappers = new Map<string, number>();
  for (const e of reg?.entries ?? []) if (e.underlyingSymbol) wrappers.set(e.underlyingSymbol, (wrappers.get(e.underlyingSymbol) ?? 0) + 1);
  const logoOf = (e: { mint: string; logo: string | null; underlyingSymbol: string | null }) =>
    e.logo ?? (reg?.entries ?? []).find((x) => x.underlyingSymbol && x.underlyingSymbol === e.underlyingSymbol && x.logo)?.logo ?? null;
  const countOf = (underlying: string | null) => (underlying ? wrappers.get(underlying) ?? 1 : 1);
  if (reg && !symbols) return listable(reg).map((e) => ({ symbol: e.symbol, name: e.name, mint: new PublicKey(e.mint), decimals: e.inspection.decimals, tier: e.tier, wrapper: e.wrapper, underlyingSymbol: e.underlyingSymbol, feeBps: e.inspection.transferFee?.bps ?? 0, replicaOf: e.replicaOf ?? null, logo: logoOf(e), wrappersOfUnderlying: countOf(e.underlyingSymbol) }));
  const wanted = symbols ?? LAUNCH_SET;
  const fromRegistry = reg ? new Map(reg.entries.map((e) => [e.symbol, e])) : new Map();
  const out: LaunchEntry[] = [];
  for (const s of wanted) {
    const r = fromRegistry.get(s);
    if (r) out.push({ symbol: r.symbol, name: r.name, mint: new PublicKey(r.mint), decimals: r.inspection.decimals, tier: r.tier, wrapper: r.wrapper, underlyingSymbol: r.underlyingSymbol, feeBps: r.inspection.transferFee?.bps ?? 0, replicaOf: r.replicaOf ?? null, logo: logoOf(r), wrappersOfUnderlying: countOf(r.underlyingSymbol) });
    else out.push(...(await resolveLaunchSet([s])));
  }
  return out;
}

/** The issuer's spot quote, the fork-only stand-in for a keyed Hermes read and the display mark elsewhere. */
export { xstocksQuote, jupiterPrice };

/*
 * The Tokens API snapshot, cached for a minute and batched across markets: a real traded price per mint with its 24
 * hour change and holder count. It is the first source tried wherever the key is set, and the only one that prices a
 * devnet replica, which takes the mark of the mainnet mint it stands in for.
 */
let snapCache: { at: number; byMint: Map<string, { price: number | null; change24hPct: number | null; holders: number | null; logo: string | null }> } = { at: 0, byMint: new Map() };
export async function refreshSnapshots(mints: string[]): Promise<void> {
  if (!tokensApiKeyed() || !mints.length || Date.now() - snapCache.at < 60_000) return;
  const fresh = await marketSnapshots(mints).catch((e: unknown) => { console.warn(`[registry] tokens.xyz snapshot: ${(e as Error).message}`); return null; });
  if (!fresh) return;
  const byMint = new Map(snapCache.byMint);
  for (const [mint, s] of fresh) byMint.set(mint, { price: s.price, change24hPct: s.change24hPct, holders: s.holders, logo: s.logo });
  snapCache = { at: Date.now(), byMint };
}
export function snapshotPrice(mint: string): number | null {
  return snapCache.byMint.get(mint)?.price ?? null;
}
export function snapshotOf(mint: string): { price: number | null; change24hPct: number | null; holders: number | null; logo: string | null } | null {
  return snapCache.byMint.get(mint) ?? null;
}

/**
 * Pre-IPO marks from the issuers, refreshed at most once a minute: with no Pyth feed the issuer's mark is the price
 * source by design (Part 2 section 2), on every cluster. Tessera publishes a mark; PreStocks a token price too.
 */
let preipoCache: { at: number; byMint: Map<string, PreIpoToken> } | null = null;
export async function issuerMark(entry: LaunchEntry): Promise<{ price: number; source: "tessera" | "prestocks" } | null> {
  if (entry.wrapper === "xStock" || entry.wrapper === "Ondo") return null;
  if (!preipoCache || Date.now() - preipoCache.at > 60_000) {
    // A refresh that fails keeps the previous marks rather than dropping every pre-IPO price for a tick.
    const [t, p] = await Promise.all([tesseraTokens().catch(() => null), prestocksTokens().catch(() => null)]);
    const fresh = [...(t ?? []), ...(p ?? [])];
    const byMint = new Map(preipoCache?.byMint ?? []);
    for (const x of fresh) byMint.set(x.mint, x);
    if (t && p) preipoCache = { at: Date.now(), byMint };
    else preipoCache = { at: preipoCache?.at ?? 0, byMint };
  }
  // A devnet replica of a pre-IPO token takes the mark of the mainnet token it stands in for.
  const t = preipoCache.byMint.get(entry.replicaOf ?? entry.mint.toBase58());
  if (!t) return null;
  const price = t.tokenPrice ?? t.markPrice;
  return price ? { price, source: t.issuer === "Tessera" ? "tessera" : "prestocks" } : null;
}

export async function resolveLaunchSet(symbols: string[]): Promise<LaunchEntry[]> {
  const out: LaunchEntry[] = [];
  for (const symbol of symbols) {
    const res = await fetch(`${XSTOCKS_API}/public/assets/${symbol}`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      console.warn(`[registry] ${symbol}: xStocks API ${res.status}, skipped`);
      continue;
    }
    const j = (await res.json()) as { name?: string; underlyingSymbol?: string; deployments?: { network: string; address: string; decimals?: number }[] };
    const dep = j.deployments?.find((d) => d.network === "Solana");
    if (!dep) {
      console.warn(`[registry] ${symbol}: no Solana deployment, skipped`);
      continue;
    }
    out.push({ symbol, name: j.name ?? symbol, mint: new PublicKey(dep.address), decimals: dep.decimals ?? 8, tier: TIER1_SET.includes(symbol) ? 1 : 2, wrapper: "xStock", underlyingSymbol: j.underlyingSymbol ?? null, feeBps: 0, replicaOf: null, logo: null, wrappersOfUnderlying: 1 });
  }
  return out;
}
