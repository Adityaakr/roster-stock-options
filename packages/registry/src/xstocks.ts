/*
 * The xStocks Assets API (docs.xstocks.fi): the issuer's own list of every xStock, its Solana mint and a spot quote.
 * Every address the registry holds comes from here or from the chain; none is typed from memory (CLAUDE.md 0).
 */
export const XSTOCKS_API = "https://api.xstocks.fi/api/v2";
const TIMEOUT = 15_000;

export interface XstocksAsset {
  symbol: string;
  name: string;
  underlyingSymbol: string | null;
  isin: string | null;
  logo: string | null;
  isTradingHalted: boolean;
  /** The Solana mint, when the asset is deployed there. */
  mint: string | null;
}

interface AssetJson {
  symbol: string;
  name?: string;
  underlyingSymbol?: string;
  isin?: string;
  logo?: string;
  isTradingHalted?: boolean;
  deployments?: { network: string; address: string }[];
}

function toAsset(j: AssetJson): XstocksAsset {
  const sol = j.deployments?.find((d) => d.network === "Solana");
  return { symbol: j.symbol, name: j.name ?? j.symbol, underlyingSymbol: j.underlyingSymbol ?? null, isin: j.isin ?? null, logo: j.logo ?? null, isTradingHalted: !!j.isTradingHalted, mint: sol?.address ?? null };
}

export async function xstocksAsset(symbol: string): Promise<XstocksAsset | null> {
  const res = await fetch(`${XSTOCKS_API}/public/assets/${encodeURIComponent(symbol)}`, { signal: AbortSignal.timeout(TIMEOUT) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`xStocks ${symbol}: HTTP ${res.status}`);
  return toAsset((await res.json()) as AssetJson);
}

/** Every listed xStock, paged. */
export async function xstocksAssets(): Promise<XstocksAsset[]> {
  const out: XstocksAsset[] = [];
  for (let page = 0; page < 50; page++) {
    const res = await fetch(`${XSTOCKS_API}/public/assets?page=${page}&pageSize=100`, { signal: AbortSignal.timeout(TIMEOUT) });
    if (!res.ok) throw new Error(`xStocks assets page ${page}: HTTP ${res.status}`);
    const j = (await res.json()) as { nodes: AssetJson[]; page: { hasNextPage: boolean } };
    out.push(...j.nodes.map(toAsset));
    if (!j.page.hasNextPage) break;
  }
  return out;
}

/** The issuer's spot quote in USD per share equivalent (`/price-data` returns `{ quote }`). */
export async function xstocksQuote(symbol: string): Promise<number | null> {
  const res = await fetch(`${XSTOCKS_API}/public/assets/${encodeURIComponent(symbol)}/price-data`, { signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) return null;
  const j = (await res.json()) as { quote?: number };
  return typeof j.quote === "number" && j.quote > 0 ? j.quote : null;
}
