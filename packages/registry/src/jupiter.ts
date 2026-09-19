/*
 * Wrapper discovery through Jupiter's token search (lite-api.jup.ag, keyless): every mint whose symbol matches the
 * underlying and that Jupiter tags as a verified stock wrapper, with the issuer read from the tags. Memecoins and
 * unverified mints are dropped by the tag rule, never by a hand-kept list. Verified 2026-09-17: AAPL returns
 * AAPLx (xstocks) and AAPLon (ondo) and a page of pump tokens tagged unknown.
 */
const JUP_TOKENS = "https://lite-api.jup.ag/tokens/v2/search";
const JUP_PRICE = "https://lite-api.jup.ag/price/v3";

/**
 * The token's price in USD from Jupiter's price API, the routed price a buyer would actually get. Used where an
 * issuer's own quote endpoint is unavailable (Ondo publishes none; the xStocks endpoint times out at times) and
 * as the display mark on the fork. Verified 2026-09-19 against NVDAx.
 */
export async function jupiterPrice(mint: string): Promise<number | null> {
  const res = await fetch(`${JUP_PRICE}?ids=${mint}`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return null;
  const j = (await res.json()) as Record<string, { usdPrice?: number }>;
  const p = j[mint]?.usdPrice;
  return typeof p === "number" && p > 0 ? p : null;
}

export type Issuer = "xStock" | "Ondo" | "Tessera" | "PreStocks" | "Other";

export interface DiscoveredWrapper {
  symbol: string;
  name: string;
  mint: string;
  decimals: number;
  issuer: Issuer;
  holders: number | null;
  tags: string[];
}

function issuerOf(tags: string[]): Issuer | null {
  if (tags.includes("xstocks")) return "xStock";
  if (tags.includes("ondo")) return "Ondo";
  return null;
}

export async function discoverWrappers(underlyingSymbol: string): Promise<DiscoveredWrapper[]> {
  const res = await fetch(`${JUP_TOKENS}?query=${encodeURIComponent(underlyingSymbol)}`, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`jupiter token search ${underlyingSymbol}: HTTP ${res.status}`);
  const j = (await res.json()) as { symbol: string; name: string; id: string; decimals: number; tags?: string[]; holderCount?: number }[];
  const base = underlyingSymbol.toUpperCase();
  return j
    .map((t) => ({ t, tags: t.tags ?? [] }))
    .filter(({ t, tags }) => tags.includes("stocks") && tags.includes("verified") && !tags.includes("unknown") && issuerOf(tags) !== null && t.symbol.toUpperCase().startsWith(base))
    .map(({ t, tags }) => ({ symbol: t.symbol, name: t.name, mint: t.id, decimals: t.decimals, issuer: issuerOf(tags)!, holders: t.holderCount ?? null, tags }));
}
