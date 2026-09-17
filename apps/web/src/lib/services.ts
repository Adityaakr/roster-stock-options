import "server-only";

/*
 * The services process (packages/services) is the app's one read path: the indexer's view of every market and series,
 * prices, the quoter's inputs, positions per wallet and events. Every call is bounded; the caller decides what a
 * missing service means (the fixture cluster in `roster-data.ts`).
 */

export const SERVICES_URL = process.env.SERVICES_URL ?? "http://127.0.0.1:8787";
const TIMEOUT_MS = Number(process.env.SERVICES_TIMEOUT_MS ?? 4_000);

export interface ServicesAsk { remaining_lots6: string; ask_per_lot: string; seq: string; writer_slot: number; writer: string | null }
export interface ServicesWriter { writer: string; deposited_lots6: string; withdrawn_lots6: string; sold_lots6: string; open_lots6: string; assigned_lots6: string; premium_claimable: string; settled: boolean }
export interface ServicesSeries {
  address: string; market: string; side: "call" | "put"; strike_usdc_per_lot: string; expiry_ts: number; position_mint: string;
  collateral_vault: string; settlement_vault: string; quote_vault: string; total_sold_lots6: string; total_exercised_lots6: string;
  unassigned_lots6: string; halted: number; collateral_balance: string; settlement_balance: string; asks: ServicesAsk[]; writers: ServicesWriter[];
}
export interface ServicesMarket {
  symbol: string; name: string; wrapper: "xStock" | "Tessera" | "PreStocks"; feeBps: number; mint: string; market: string; decimals: number; tier: number; listed: boolean; paused: boolean;
  hasTransferFee: boolean; hasPermanentDelegate: boolean; pausable: boolean; hookProgram: string; allowedExpiries: string[]; strikeStep: string;
  minLots6: string; maxLots6: string; maxLiveSeries: number; liveSeries: number; price: number | null; priceAt: number; priceSource: "hermes" | "reference" | "xstocks" | "tessera" | "prestocks" | "none";
  equityPrice: number | null; basisBps: number | null; multiplier: number; pendingActivationTs: number | null; inActivationWindow: boolean; vol: number; volSource: string;
  series: ServicesSeries[];
}
export interface ServicesRoster {
  cluster: string; programDeployed: boolean; program: string; nowTs: number; session: string; feeBps: number | null; keeperFeeUsdc: string | null;
  graceSecs: string | null; treasury: string | null; quoter: string | null; blocked: string | null; hermesKeyed?: boolean; markets: ServicesMarket[];
}
export interface ServicesEvent { signature: string; ix_index: number; slot: number; block_time: number; name: string; data_json: string }
export interface ServicesPosition { series: string; market: string; side: "call" | "put"; strike_usdc_per_lot: string; expiry_ts: number; position_mint: string; lots6: string; autoExercise: boolean }
export interface ServicesPositions { wallet: string; positions: ServicesPosition[]; events: ServicesEvent[] }
export interface ServicesHealth { ok: boolean; cluster: string; lastTick: number; blocked: string | null; program: string; hermesKeyed: boolean }

async function get<T>(path: string, timeoutMs = TIMEOUT_MS): Promise<T> {
  const res = await fetch(`${SERVICES_URL}${path}`, { cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`services ${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export const services = {
  health: () => get<ServicesHealth>("/v1/health"),
  roster: () => get<ServicesRoster>("/v1/roster"),
  positions: (wallet: string) => get<ServicesPositions>(`/v1/positions/${wallet}`, 15_000),
  events: (q: { name?: string; series?: string; limit?: number }) => {
    const p = new URLSearchParams();
    if (q.name) p.set("name", q.name);
    if (q.series) p.set("series", q.series);
    if (q.limit) p.set("limit", String(q.limit));
    return get<ServicesEvent[]>(`/v1/events?${p.toString()}`);
  }
};

/** True when the services answer; the app falls back to the fixture cluster otherwise and says so. */
export async function servicesReachable(): Promise<boolean> {
  try {
    const h = await services.health();
    return !!h.program;
  } catch {
    return false;
  }
}
