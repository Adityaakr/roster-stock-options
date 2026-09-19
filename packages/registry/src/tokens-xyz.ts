/*
 * The Tokens API (api.tokens.xyz), the asset registry Part 2 section 2.6 names: a mint resolves to a canonical asset,
 * an asset lists its tokenized-equity variants with a wrapper tier, and a batch of mints returns a market snapshot.
 *
 * It matters twice over. It is where a wrapper's tier comes from, and, since Pyth Core now refuses every feed this
 * product needs without a paid grant, its snapshot is a real traded price for a real mint: mark, 24 hour change,
 * liquidity and holders, in one keyed call. Nothing here is required; every caller falls back when the key is absent.
 */
const BASE = "https://api.tokens.xyz/v1";
const TIMEOUT_MS = 12_000;

export interface TokensSnapshot {
  mint: string;
  symbol: string | null;
  price: number | null;
  change24hPct: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  holders: number | null;
  logo: string | null;
}

/** The wrapper's tier as the Tokens API states it, e.g. `cash_redeemable`; null when the key or the variant is absent. */
export interface TokensVariant { mint: string; symbol: string | null; label: string | null; stockVariantTier: string | null; advisory: string | null }

function key(): string | null {
  const k = process.env.TOKENS_XYZ_API_KEY;
  return k && k.trim() ? k.trim() : null;
}

export function tokensApiKeyed(): boolean {
  return !!key();
}

async function get<T>(path: string, init?: RequestInit): Promise<T | null> {
  const k = key();
  if (!k) return null;
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { "x-api-key": k, ...(init?.body ? { "content-type": "application/json" } : {}) }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`tokens.xyz ${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

interface RawSnapshot { address?: string; token?: { address?: string; symbol?: string; price?: number; priceChange24hPercent?: number; liquidity?: number; volume24hUSD?: number; holder?: number; logoURI?: string } }

/** One call for many mints. Mints the API does not know are simply absent from the result. */
export async function marketSnapshots(mints: string[]): Promise<Map<string, TokensSnapshot>> {
  const out = new Map<string, TokensSnapshot>();
  if (!mints.length) return out;
  const rows = await get<RawSnapshot[]>("/assets/market-snapshots", { method: "POST", body: JSON.stringify({ mints }) });
  for (const r of rows ?? []) {
    const mint = r.address ?? r.token?.address;
    if (!mint) continue;
    const t = r.token ?? {};
    out.set(mint, {
      mint,
      symbol: t.symbol ?? null,
      price: typeof t.price === "number" && t.price > 0 ? t.price : null,
      change24hPct: typeof t.priceChange24hPercent === "number" ? t.priceChange24hPercent : null,
      liquidityUsd: typeof t.liquidity === "number" ? t.liquidity : null,
      volume24hUsd: typeof t.volume24hUSD === "number" ? t.volume24hUSD : null,
      holders: typeof t.holder === "number" ? t.holder : null,
      logo: t.logoURI ?? null,
    });
  }
  return out;
}

interface RawVariants { assetId?: string; variants?: { mint?: string; symbol?: string; label?: string; stockVariantTier?: string; advisory?: string | null }[] }

/** Every tokenized-equity wrapper of one canonical asset, with the tier the Tokens API assigns each. */
export async function variants(assetId: string): Promise<TokensVariant[]> {
  const j = await get<RawVariants>(`/assets/${encodeURIComponent(assetId)}/variants?kind=tokenized_equity`);
  return (j?.variants ?? []).filter((v) => v.mint).map((v) => ({ mint: v.mint!, symbol: v.symbol ?? null, label: v.label ?? null, stockVariantTier: v.stockVariantTier ?? null, advisory: v.advisory ?? null }));
}

/** The canonical asset a mint belongs to, so a wrapper can be compared with every other wrapper of the same stock. */
export async function resolveAsset(mint: string): Promise<{ assetId: string; name: string | null; symbol: string | null; stockVariantTier: string | null } | null> {
  const j = await get<{ assetId?: string; asset?: { name?: string; symbol?: string }; variant?: { stockVariantTier?: string } }>(`/assets/resolve?mint=${mint}`);
  if (!j?.assetId) return null;
  return { assetId: j.assetId, name: j.asset?.name ?? null, symbol: j.asset?.symbol ?? null, stockVariantTier: j.variant?.stockVariantTier ?? null };
}
