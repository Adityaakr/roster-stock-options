/*
 * The quoter's pricing model (docs/PLAN.md, docs/QUOTER.md): Black-Scholes on the lot with r = q = 0 over blended
 * realised volatility with a floor, a spread multiplier by session, a wider one inside a multiplier activation window,
 * an inventory skew, and the forward adjustment only when the pending activation is a dividend. Pure functions; the
 * loop in quoter.ts decides when to call them and logs every input.
 */
import type { Session } from "@roster/core";

export const SESSION_SPREAD: Record<Session, number> = { regular: 1.0, pre: 1.4, post: 1.4, overnight: 1.8, closed: 2.2 };
export const ACTIVATION_SPREAD = 3.0;

function erf(x: number): number {
  // Abramowitz and Stegun 7.1.26, max error 1.5e-7.
  const s = Math.sign(x);
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return s * y;
}
export function normCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

/** Theoretical value of a call or put per lot in USD, r = q = 0. `s` and `k` in USD per lot, `t` in years. */
export function blackScholes(side: "call" | "put", s: number, k: number, t: number, sigma: number): number {
  if (t <= 0 || sigma <= 0) return side === "call" ? Math.max(0, s - k) : Math.max(0, k - s);
  const sq = sigma * Math.sqrt(t);
  const d1 = (Math.log(s / k) + 0.5 * sigma * sigma * t) / sq;
  const d2 = d1 - sq;
  return side === "call" ? s * normCdf(d1) - k * normCdf(d2) : k * normCdf(-d2) - s * normCdf(-d1);
}

export interface QuoteInputs {
  side: "call" | "put";
  /** Token feed price per share-equivalent, USD. */
  price: number;
  /** Effective multiplier: one lot is `multiplier` share-equivalents. */
  multiplier: number;
  /** Pending activation that precedes expiry and is a dividend: forward uses the new multiplier. */
  pendingDividendMultiplier: number | null;
  strikeUsdcPerLot: bigint;
  expiryTs: number;
  nowTs: number;
  vol: number;
  session: Session;
  inActivationWindow: boolean;
  /** Lots the quoter has already sold in this series, net; positive skews the ask up. */
  inventoryLots: number;
  /** Half-spread in fraction of theoretical value at the regular session, e.g. 0.12. */
  baseSpread: number;
  /** Minimum ask per lot in micro-USDC so a deep OTM contract never quotes for dust. */
  minAskPerLot: bigint;
}

export interface QuoteDecision {
  askPerLot: bigint;
  theoretical: number;
  forwardPerLot: number;
  strikePerLot: number;
  t: number;
  spread: number;
  reason: string;
}

export function decideAsk(i: QuoteInputs): QuoteDecision {
  const multiplier = i.pendingDividendMultiplier ?? i.multiplier;
  const forwardPerLot = i.price * multiplier;
  const strikePerLot = Number(i.strikeUsdcPerLot) / 1e6;
  const t = Math.max(0, (i.expiryTs - i.nowTs) / (365 * 86_400));
  const theoretical = blackScholes(i.side, forwardPerLot, strikePerLot, t, i.vol);
  let spread = i.baseSpread * SESSION_SPREAD[i.session];
  if (i.inActivationWindow) spread *= ACTIVATION_SPREAD;
  const skew = 1 + Math.max(0, i.inventoryLots) * 0.002;
  const ask = theoretical * (1 + spread) * skew;
  const askMicro = BigInt(Math.ceil(ask * 1e6));
  const askPerLot = askMicro > i.minAskPerLot ? askMicro : i.minAskPerLot;
  return { askPerLot, theoretical, forwardPerLot, strikePerLot, t, spread, reason: `bs(${i.side} S=${forwardPerLot.toFixed(4)} K=${strikePerLot} t=${t.toFixed(5)} vol=${i.vol.toFixed(3)}) x (1+${spread.toFixed(3)}) x skew ${skew.toFixed(3)} [${i.session}${i.inActivationWindow ? ",activation" : ""}]` };
}

/** Three strikes a side around the forward, on the market's step, in micro-USDC per lot. */
export function gridStrikes(side: "call" | "put", forwardPerLot: number, stepMicro: bigint, offsets: number[] = [0, 0.025, 0.05]): bigint[] {
  const step = Number(stepMicro) / 1e6;
  return offsets.map((o) => {
    const k = side === "call" ? forwardPerLot * (1 + o) : forwardPerLot * (1 - o);
    const rounded = (side === "call" ? Math.ceil(k / step) : Math.floor(k / step)) * step;
    return BigInt(Math.round(rounded * 1e6));
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Part 3: the vault's two-sided quote.

export interface VaultQuoteInputs extends Omit<QuoteInputs, "inventoryLots"> {
  /** Lots the vault has sold in this series, net of buybacks, against its per-series cap. */
  soldLots: number;
  capLots: number;
  /** The bid's half-spread below theoretical at the regular session, before the session multiplier. */
  bidSpread: number;
}

export interface VaultQuoteDecision extends QuoteDecision {
  /** Null when the vault is at capacity on this series: it stops asking and says so. */
  askPerLot: bigint;
  atCapacity: boolean;
  utilisation: number;
  skew: number;
  bidPerLot: bigint;
  intrinsicPerLot: number;
  sessionMultiplier: number;
}

/**
 * Utilisation skew: the more of a series the vault has sold, the higher its ask, on a convex curve that rises steeply
 * toward the cap. `1 + 3u²` is 1.03 at a tenth sold, 1.75 at half, 3.4 at nine tenths; at the cap the vault stops.
 * This is the direct fix for what hurt Hegic: a pool that sells at one implied volatility whatever the flow.
 */
export function utilisationSkew(soldLots: number, capLots: number): { u: number; skew: number; atCapacity: boolean } {
  if (capLots <= 0) return { u: 0, skew: 1, atCapacity: false };
  const u = Math.max(0, Math.min(1, soldLots / capLots));
  return { u, skew: 1 + 3 * u * u, atCapacity: u >= 1 };
}

export function decideVaultQuote(i: VaultQuoteInputs): VaultQuoteDecision {
  const base = decideAsk({ ...i, inventoryLots: 0 });
  const { u, skew, atCapacity } = utilisationSkew(i.soldLots, i.capLots);
  const sessionMultiplier = SESSION_SPREAD[i.session] * (i.inActivationWindow ? ACTIVATION_SPREAD : 1);
  const askMicro = BigInt(Math.ceil(base.theoretical * (1 + base.spread) * skew * 1e6));
  const askPerLot = askMicro > i.minAskPerLot ? askMicro : i.minAskPerLot;
  // The bid: theoretical less the bid spread, widened by the session, never below intrinsic.
  const intrinsic = Math.max(0, i.side === "call" ? base.forwardPerLot - base.strikePerLot : base.strikePerLot - base.forwardPerLot);
  const bid = Math.max(intrinsic, base.theoretical * (1 - i.bidSpread * sessionMultiplier));
  const bidPerLot = BigInt(Math.floor(bid * 1e6));
  return { ...base, askPerLot, atCapacity, utilisation: u, skew, bidPerLot, intrinsicPerLot: intrinsic, sessionMultiplier, reason: `${base.reason} x skew ${skew.toFixed(3)} (u=${u.toFixed(2)}) · bid ${(bid).toFixed(4)} (intrinsic ${intrinsic.toFixed(4)}, session x${sessionMultiplier.toFixed(1)})` };
}
