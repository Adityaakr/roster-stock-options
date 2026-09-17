/*
 * Realised volatility from Pyth Benchmarks (CLAUDE.md 2.2): daily closes over 7, 30 and 90 day windows, blended
 * 0.5/0.3/0.2 with a floor, refreshed hourly. Falls back to a stated floor when Benchmarks is unreachable so the
 * quoter widens instead of stopping; every use logs which it was.
 */
export const BENCHMARKS_URL = process.env.PYTH_BENCHMARKS_URL ?? "https://benchmarks.pyth.network";

export interface VolEstimate {
  vol7: number | null;
  vol30: number | null;
  vol90: number | null;
  blended: number;
  source: "benchmarks" | "floor";
  at: number;
}

/** Annualised realised volatility from a series of closes (log returns, sample stdev, 365 days). */
export function realisedVol(closes: number[]): number | null {
  if (closes.length < 3) return null;
  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const a = closes[i - 1]!;
    const b = closes[i]!;
    if (a > 0 && b > 0) rets.push(Math.log(b / a));
  }
  if (rets.length < 2) return null;
  const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
  const v = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(v) * Math.sqrt(365);
}

export function blend(vol7: number | null, vol30: number | null, vol90: number | null, floor: number): { blended: number; source: "benchmarks" | "floor" } {
  const parts: [number | null, number][] = [[vol7, 0.5], [vol30, 0.3], [vol90, 0.2]];
  let acc = 0;
  let w = 0;
  for (const [v, wt] of parts) if (v !== null && Number.isFinite(v)) { acc += v * wt; w += wt; }
  if (w === 0) return { blended: floor, source: "floor" };
  return { blended: Math.max(floor, acc / w), source: "benchmarks" };
}

/** Daily closes for `days` from Benchmarks' TradingView-style history endpoint; null when unavailable. */
export async function dailyCloses(feedSymbol: string, days: number, apiKey?: string): Promise<number[] | null> {
  const to = Math.floor(Date.now() / 1000);
  const from = to - days * 86_400;
  const url = `${BENCHMARKS_URL}/v1/shims/tradingview/history?symbol=${encodeURIComponent(feedSymbol)}&resolution=D&from=${from}&to=${to}`;
  try {
    const res = await fetch(url, { headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {}, signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return null;
    const j = (await res.json()) as { s?: string; c?: number[] };
    if (j.s !== "ok" || !Array.isArray(j.c)) return null;
    return j.c;
  } catch {
    return null;
  }
}

export async function estimateVol(feedSymbol: string, floor: number, apiKey?: string): Promise<VolEstimate> {
  const closes = await dailyCloses(feedSymbol, 91, apiKey);
  const at = Math.floor(Date.now() / 1000);
  if (!closes) return { vol7: null, vol30: null, vol90: null, blended: floor, source: "floor", at };
  const vol7 = realisedVol(closes.slice(-8));
  const vol30 = realisedVol(closes.slice(-31));
  const vol90 = realisedVol(closes.slice(-91));
  const b = blend(vol7, vol30, vol90, floor);
  return { vol7, vol30, vol90, blended: b.blended, source: b.source, at };
}
