/*
 * Real trade history for a token that has no Pyth feed: GeckoTerminal's public API (no key, about 30 calls a minute)
 * serves OHLCV per pool. For a PreStocks token the most-traded USDC pool is the reference: its closes give the chart,
 * the day and week changes, the sparkline and, in the services, the realised volatility the quoter prices from.
 * Verified 2026-09-21 on `PrekqLJvJ3qVdXmBGDiexvwUTF4rLFDa6HWS4HJbw9S` (NEURALINK / USDC, 51 daily candles).
 * Everything here is cached in memory so the desk never spends the rate limit twice on the same answer.
 */
const BASE = "https://api.geckoterminal.com/api/v2";

export interface Pool { address: string; name: string; liquidityUsd: number | null; volume24hUsd: number | null; priceUsd: number | null }
/** [unix seconds, open, high, low, close, volume usd] */
export type Candle = [number, number, number, number, number, number];

const poolCache = new Map<string, { at: number; pool: Pool | null }>();
const candleCache = new Map<string, { at: number; candles: Candle[] }>();
const POOL_TTL = 6 * 3_600_000;
const CANDLE_TTL: Record<string, number> = { day: 30 * 60_000, hour: 5 * 60_000, minute: 60_000 };

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`geckoterminal: HTTP ${res.status} on ${path}`);
  return (await res.json()) as T;
}

/**
 * The reference pool for a mint on Solana: quoted in USDC (or USDT, or SOL as a last resort), the one with the most
 * volume in the last day. Volume, not liquidity: a deep pool nobody trades in carries a stale price, and the point
 * of the history is where the price is actually discovered.
 */
export async function referencePool(mint: string): Promise<Pool | null> {
  const hit = poolCache.get(mint);
  if (hit && Date.now() - hit.at < POOL_TTL) return hit.pool;
  const j = await get<{ data?: { id: string; attributes: { name?: string; address?: string; reserve_in_usd?: string; volume_usd?: { h24?: string }; base_token_price_usd?: string }; relationships?: { base_token?: { data?: { id?: string } }; quote_token?: { data?: { id?: string } } } }[] }>(`/networks/solana/tokens/${mint}/pools?page=1`);
  const rows = (j.data ?? []).map((p) => {
    const a = p.attributes;
    const quote = (a.name ?? "").split("/")[1]?.trim() ?? "";
    const baseIsMint = (p.relationships?.base_token?.data?.id ?? "").endsWith(mint);
    return { address: a.address ?? p.id.replace(/^solana_/, ""), name: a.name ?? "", quote, baseIsMint, liquidityUsd: num(a.reserve_in_usd), volume24hUsd: num(a.volume_usd?.h24), priceUsd: num(a.base_token_price_usd) };
  }).filter((r) => r.baseIsMint);
  const rank = (q: string) => (q === "USDC" ? 0 : q === "USDT" ? 1 : q === "SOL" ? 2 : 9);
  // Volume first, with a tenth of the liquidity added so a deep AMM pool that trades outranks a book venue that
  // reports no reserve, and a deep pool nobody trades in never wins (NEURALINK, 2026-09-21: seven USDC pools).
  const score = (r: { volume24hUsd: number | null; liquidityUsd: number | null }) => (r.volume24hUsd ?? 0) + (r.liquidityUsd ?? 0) / 10;
  rows.sort((a, b) => rank(a.quote) - rank(b.quote) || score(b) - score(a));
  const best = rows[0];
  const pool: Pool | null = best && rank(best.quote) < 9 ? { address: best.address, name: best.name, liquidityUsd: best.liquidityUsd, volume24hUsd: best.volume24hUsd, priceUsd: best.priceUsd } : null;
  poolCache.set(mint, { at: Date.now(), pool });
  return pool;
}

/** Candles for a pool, oldest first, in USD. `timeframe` day or hour; `limit` up to 1000. */
export async function candles(pool: string, timeframe: "day" | "hour" | "minute", limit = 200): Promise<Candle[]> {
  const key = `${pool}:${timeframe}:${limit}`;
  const hit = candleCache.get(key);
  if (hit && Date.now() - hit.at < (CANDLE_TTL[timeframe] ?? 300_000)) return hit.candles;
  const j = await get<{ data?: { attributes?: { ohlcv_list?: number[][] } } }>(`/networks/solana/pools/${pool}/ohlcv/${timeframe}?aggregate=1&limit=${limit}&currency=usd`);
  const list = (j.data?.attributes?.ohlcv_list ?? []).filter((c) => c.length >= 6 && c[4]! > 0).map((c) => [c[0], c[1], c[2], c[3], c[4], c[5]] as Candle).sort((a, b) => a[0] - b[0]);
  candleCache.set(key, { at: Date.now(), candles: list });
  return list;
}

/** The token's trade history in one call: the reference pool, daily closes for the long view, hourly for the short. */
export async function tokenHistory(mint: string): Promise<{ pool: Pool | null; daily: Candle[]; hourly: Candle[] } | null> {
  // A refused or failed call throws, so the caller can tell "no pool" from "not now" and try again later.
  const pool = await referencePool(mint);
  if (!pool) return null;
  const daily = await candles(pool.address, "day", 365);
  const hourly = await candles(pool.address, "hour", 336);
  if (!daily.length && !hourly.length) throw new Error("no candles returned");
  return { pool, daily, hourly };
}

/** Percent change of the last close over the close `secondsBack` earlier, from daily or hourly candles; null when the history is shorter. */
export function changePct(rows: Candle[], secondsBack: number): number | null {
  if (rows.length < 2) return null;
  const last = rows[rows.length - 1]!;
  const target = last[0] - secondsBack;
  let ref: Candle | null = null;
  for (const c of rows) { if (c[0] <= target) ref = c; else break; }
  if (!ref || ref[4] <= 0) return null;
  return ((last[4] - ref[4]) / ref[4]) * 100;
}

function num(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}
