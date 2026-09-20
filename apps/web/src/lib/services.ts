import "server-only";

/*
 * The services process (packages/services) is the app's one read path: the indexer's view of every market and series,
 * prices, the quoter's inputs, positions per wallet and events. Every call is bounded; the caller decides what a
 * missing service means (the fixture cluster in `roster-data.ts`).
 */

export const SERVICES_URL = process.env.SERVICES_URL ?? "http://127.0.0.1:8787";
const TIMEOUT_MS = Number(process.env.SERVICES_TIMEOUT_MS ?? 8_000);

export interface ServicesAsk { remaining_lots6: string; ask_per_lot: string; seq: string; writer_slot: number; writer: string | null }
export interface ServicesWriter { writer: string; deposited_lots6: string; withdrawn_lots6: string; sold_lots6: string; open_lots6: string; assigned_lots6: string; premium_claimable: string; settled: boolean }
export interface ServicesSeries {
  address: string; market: string; side: "call" | "put"; strike_usdc_per_lot: string; expiry_ts: number; position_mint: string;
  collateral_vault: string; settlement_vault: string; quote_vault: string; total_sold_lots6: string; total_exercised_lots6: string;
  unassigned_lots6: string; halted: number; collateral_balance: string; settlement_balance: string; asks: ServicesAsk[]; writers: ServicesWriter[];
}
export interface ServicesMarket {
  symbol: string; name: string; wrapper: "xStock" | "Ondo" | "Tessera" | "PreStocks"; feeBps: number; mint: string; sparkline?: [number, number][]; market: string; decimals: number; tier: number; listed: boolean; paused: boolean;
  hasTransferFee: boolean; hasPermanentDelegate: boolean; pausable: boolean; hookProgram: string; allowedExpiries: string[]; strikeStep: string;
  minLots6: string; maxLots6: string; maxLiveSeries: number; liveSeries: number; price: number | null; priceAt: number; priceSource: "hermes" | "reference" | "tokens.xyz" | "xstocks" | "jupiter" | "tessera" | "prestocks" | "none";
  /** Devnet only: the mainnet mint this market's token replicates and takes its price from. */
  replicaOf?: string | null;
  /** The issuer's logo, the stock behind the wrapper and how many wrappers of it exist, from the cluster's registry. */
  logo?: string | null;
  underlyingSymbol?: string | null;
  wrappersOfUnderlying?: number;
  change24hPct?: number | null;
  holders?: number | null;
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
export interface ServicesPrices { mint: string; mark: [number, number][]; token: [number, number][]; equity: [number, number][]; basis: { bps: number; at: number }[] }
export interface ServicesVaultEpoch { epoch: number; rolledAt: number; navCollateralRaw: string; navOther: string; markUsdcPerLot: string; totalSharesAfter: string; premiumIn: string; buybackOut: string; assignedLots6: string; pnlPerShare1e6: string; sharesPerRaw1e12: string; collateralPerShare1e12: string; otherPerShare1e12: string }
export interface ServicesVault {
  symbol: string; address: string; kind: "covered_call" | "cash_secured_put"; halted: boolean; manager: string; shareMint: string; collateralMint: string; otherMint: string; collateralAta: string; otherAta: string;
  collateralBalance: string; otherBalance: string; epoch: number; epochStartTs: number; nextRollTs: number; rollIntervalSecs: number; totalShares: string; lockedRaw: string; pendingDepositRaw: string; pendingWithdrawShares: string;
  reservedCollateralRaw: string; reservedOther: string; capPerSeriesLots6: string; spreadBps: number; lastMarkUsdcPerLot: string; markBandBps: number; epochPremiumIn: string; epochBuybackOut: string; epochAssignedLots6: string;
  navPerShare1e6: string; epochPnlPerShare1e6: string; epochs: ServicesVaultEpoch[];
}
export interface ServicesVaultBid { series: string; bidPerLot: string; maxLots6: string; postedAt: number; expiresAt: number }
export interface ServicesVaultPosition { shares: string; queuedDepositRaw: string; queuedDepositEpoch: number | null; queuedWithdrawShares: string; queuedWithdrawEpoch: number | null }
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
  vaults: () => get<ServicesVault[]>("/v1/vaults", 15_000),
  vaultBid: (vault: string, series: string) => get<ServicesVaultBid | null>(`/v1/vaults/${vault}/bid/${series}`),
  vaultPosition: (vault: string, wallet: string) => get<ServicesVaultPosition>(`/v1/vaults/${vault}/position/${wallet}`),
  prices: (mint: string, sinceUnix: number) => get<ServicesPrices>(`/v1/prices/${mint}?since=${sinceUnix}`),
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
