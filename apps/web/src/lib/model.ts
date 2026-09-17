/*
 * The contract model the app renders. On-chain a series is a strike in USDC per lot and positions are lots of one
 * underlying token each (CLAUDE.md 4.1, Part 2 section 3); everything here is the display layer over those integers:
 * shares = lots x multiplier, strike per share = strike per lot / multiplier. The quoter prices in per-share terms
 * against Pyth; the program never reads a price except in auto-exercise.
 */

export type Side = "call" | "put";
export type Session = "regular" | "pre" | "post" | "overnight" | "closed";

export type Tier = 1 | 2 | 3;

export interface Market {
  symbol: string;
  name: string;
  /** Null only on the fixture cluster: an address is never invented. */
  mint: string | null;
  address: string | null;
  decimals: number;
  tier: Tier;
  listed: boolean;
  paused: boolean;
  wrapperTier: string;
  /** Transfer fee on the mint in basis points; a Gap on such a mint delivers the raw amount less this on exercise. */
  feeBps: number;
  hasTransferFee: boolean;
  hasPermanentDelegate: boolean;
  pausable: boolean;
  /** Token mark from the 24/7 token feed, USD per share equivalent; null when no feed answered. */
  mark: number | null;
  priceSource: "hermes" | "reference" | "xstocks" | "tessera" | "prestocks" | "fixture" | "none";
  equityMark: number | null;
  basisBps: number | null;
  multiplier: number;
  pendingActivationTs: number | null;
  inActivationWindow: boolean;
  /** Realised volatility the quoter used, annualised, and where it came from. */
  vol: number;
  volSource: string;
  expiries: number[];
  liveSeries: number;
  maxLiveSeries: number;
  /** The smallest size the program accepts, in lots6, as a string. */
  minLots6: string;
  /** Executable depth: USDC notional fillable right now across every live term. */
  depthUsdc: number;
  bestAsk: number | null;
  /** The stock behind the wrapper (AAPL for AAPLx and AAPLon) and how many wrappers of it the registry knows. */
  underlyingSymbol: string | null;
  wrappersOfUnderlying: number;
  /** The issuer's logo when the registry has one; null is rendered as the symbol's initials, never a placeholder image. */
  logo: string | null;
  /** Marks recorded by the services over the last day, [unix, price], for the list's sparkline. */
  sparkline: [number, number][];
  /** Change over the sparkline's window, percent; null until two points exist. */
  changePct: number | null;
}

export interface Term {
  /** Stable id used in URLs: `${symbol}-${side}-${strike per lot in USDC}-${expiryTs}` with the symbol lower-cased. */
  id: string;
  market: string;
  /** Series account and its position mint; null on the fixture cluster. */
  series: string | null;
  positionMint: string | null;
  side: Side;
  /** Display strike per share, USD. */
  strike: number;
  /** Unix seconds, 16:00 New York on a Friday. */
  expiryTs: number;
  /** Best ask, premium per share in USD, at the smallest quoted size. */
  ask: number;
  /** Quoted premium per share at three sizes, ascending. Wider sizes pay more; null when the size is not fillable. */
  ladder: { size: number; ask: number | null; underwriters: number }[];
  /** Shares still fillable at any price. */
  capacity: number;
  /** Shares filled so far at this term. */
  openInterest: number;
  /** Strike and best ask in the program's own units, USDC micro per lot, as strings for the transaction builders. */
  strikePerLot: string;
  bestAskPerLot: string | null;
  /** The resident asks, cheapest first, for the exact cost of a size (`walkAsks`). */
  asks: { askPerLot: string; remainingLots6: string; writerSlot: number; seq: string }[];
  /** The escrow that backs a fill on this term; null on the fixture cluster. */
  escrow: { collateralVault: string; settlementVault: string; quoteVault: string; collateralBalance: string; settlementBalance: string } | null;
  /** Writers with live asks on this term. */
  writers: { account: string; live: boolean; askLots: number }[];
  /** Every writer slot in the series, in slot order, in shares (lots x multiplier) and USD. */
  slots: { slot: number; account: string; deposited: number; withdrawn: number; sold: number; open: number; assigned: number; premiumClaimable: number; settled: boolean }[];
  halted: boolean;
}

export interface Underwriter {
  name: string;
  kind: "treasury" | "maker" | "external";
  /** The wallet or escrow signer. Null until the program is deployed: an address is never invented. */
  account: string | null;
  usdcReserved: number;
  underlyingReserved: number;
  live: boolean;
}

export interface Position {
  id: string;
  termId: string;
  market: string;
  series: string | null;
  side: Side;
  strike: number;
  expiryTs: number;
  shares: number;
  /** Total premium paid, USD. */
  premiumPaid: number;
  /** Shares already exercised. */
  exercised: number;
  /** Signature of the buy, null on a cluster with no program. */
  signature: string | null;
  /** The auto-exercise delegate state for this holder and series. */
  autoExercise: boolean;
  expired: boolean;
}

export interface ExerciseEvent {
  ts: number;
  termId: string;
  shares: number;
  kind: "exercise" | "auto_exercise" | "release";
  ok: boolean;
  signature: string | null;
  note: string;
}

/** One line of a wallet's history: buys, exercises, claims, withdrawals and releases, each with its signature. */
export interface Receipt {
  ts: number;
  kind: "buy" | "exercise" | "auto_exercise" | "claim" | "withdraw" | "release" | "quote";
  market: string;
  termId: string;
  note: string;
  signature: string;
}

export interface Underlying {
  symbol: string;
  name: string;
  mint: string | null;
  /** Token mark from the 24/7 token feed, USD per share equivalent. */
  mark: number;
  /** Equity reference from the regular-session feed, null when that feed is closed. */
  equityMark: number | null;
  /** Token versus share basis in basis points; null when the equity feed is closed. */
  basisBps: number | null;
  /** The xStocks scaled UI multiplier and its pending activation, if any. */
  multiplier: number;
  pendingActivationTs: number | null;
  wrapperTier: string;
}

export interface RosterData {
  cluster: "fixture" | "fork" | "devnet" | "mainnet";
  clusterLabel: string;
  programDeployed: boolean;
  /** Set when the services cannot price: the name of the missing operator input (docs/OPERATOR.md). */
  blocked: string | null;
  /** Whether the keeper can post Pyth updates, which auto-exercise at expiry needs. */
  autoExerciseLive: boolean;
  nowTs: number;
  session: Session;
  /** Every listed market, sorted by executable depth. */
  markets: Market[];
  /** The market the screen is on: the first by depth unless `?m=` says otherwise. */
  underlying: Underlying;
  expiries: number[];
  terms: Term[];
  underwriters: Underwriter[];
  positions: Position[];
  exercises: ExerciseEvent[];
  feeBps: number;
  keeperFeeUsd: number;
  /** Where the numbers came from, printed under every instrument. */
  source: string;
}

export const DEFAULT_SIZE = 10;

export function termId(symbol: string, side: Side, strikePerLotUsdc: number, expiryTs: number): string {
  return `${symbol.toLowerCase()}-${side}-${strikePerLotUsdc}-${expiryTs}`;
}

export function parseTermId(id: string): { symbol: string; side: Side; strike: number; expiryTs: number } | null {
  const m = id.match(/^([a-z0-9]+)-(call|put)-(\d+(?:\.\d+)?)-(\d+)$/);
  if (!m) return null;
  return { symbol: m[1] as string, side: m[2] as Side, strike: Number(m[3]), expiryTs: Number(m[4]) };
}

export const TIER_LABEL: Record<Tier, string> = { 1: "Tier 1", 2: "Tier 2", 3: "Tier 3" };
export const TIER_RULE: Record<Tier, string> = {
  1: "Treasury quotes every term, both sides, at three sizes. The launch set.",
  2: "Treasury quotes the nearest expiry only. Promoted to Tier 1 after four weeks of fills.",
  3: "Listed and tradable; quotes come from external underwriters only. Promoted after 30 days of depth."
};

/** The product name the button carries; the instrument name belongs in the docs. */
export function productName(side: Side): "Gap" | "Floor" {
  return side === "call" ? "Gap" : "Floor";
}

/* ---------- Sessions and expiries (New York clock) ---------- */

function nyParts(unix: number): { weekday: number; minutes: number } {
  const d = new Date(unix * 1000);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "numeric", hour12: false }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  const hour = Number(get("hour")) % 24;
  return { weekday: wd, minutes: hour * 60 + Number(get("minute")) };
}

/**
 * Which US equity session the clock is in. Regular 09:30 to 16:00, pre 04:00 to 09:30, post 16:00 to 20:00, overnight
 * 20:00 to 04:00 Sunday to Thursday (Pyth market hours, docs.pyth.network/price-feeds/market-hours). NYSE holidays
 * are not modelled here; the keeper reads the feed's own status for that.
 */
export function sessionAt(unix: number): Session {
  const { weekday, minutes } = nyParts(unix);
  const weekdayTrading = weekday >= 1 && weekday <= 5;
  if (weekdayTrading) {
    if (minutes >= 570 && minutes < 960) return "regular";
    if (minutes >= 240 && minutes < 570) return "pre";
    if (minutes >= 960 && minutes < 1200) return "post";
  }
  // Overnight: 20:00 Sun-Thu through 04:00 the next morning.
  if (weekday >= 0 && weekday <= 4 && minutes >= 1200) return "overnight";
  if (weekday >= 1 && weekday <= 5 && minutes < 240) return "overnight";
  return "closed";
}

export const SESSION_LABEL: Record<Session, string> = { regular: "Regular session", pre: "Pre-market", post: "Post-market", overnight: "Overnight", closed: "Equity market closed" };

/** 16:00 New York on the next `n` Fridays strictly after `unix`. */
export function nextFridays(unix: number, n: number): number[] {
  const out: number[] = [];
  // Walk day by day from today; cheap and free of DST arithmetic.
  let t = unix - (unix % 3600);
  for (let i = 0; i < 21 && out.length < n; i++) {
    const day = t + i * 86_400;
    const { weekday } = nyParts(day);
    if (weekday !== 5) continue;
    // Find 16:00 NY on that day by scanning hours.
    const base = day - (day % 86_400) - 86_400;
    for (let h = 0; h < 72; h++) {
      const cand = base + h * 3600;
      const p = nyParts(cand);
      if (p.weekday === 5 && p.minutes === 960 && cand > unix) {
        if (!out.includes(cand)) out.push(cand);
        break;
      }
    }
    t = day;
  }
  return out.slice(0, n);
}

/* ---------- Payoff arithmetic (display only) ---------- */

/** Profit or loss at expiry for a buyer of `shares` at `premium` per share, in USD, at spot `s`. */
export function buyerPnl(side: Side, strike: number, premium: number, shares: number, s: number): number {
  const intrinsic = side === "call" ? Math.max(0, s - strike) : Math.max(0, strike - s);
  return (intrinsic - premium) * shares;
}

export function breakEven(side: Side, strike: number, premium: number): number {
  return side === "call" ? strike + premium : strike - premium;
}

/** Percentage move from `mark` the buyer needs for the contract to break even. */
export function moveNeeded(side: Side, strike: number, premium: number, mark: number): number {
  return ((breakEven(side, strike, premium) - mark) / mark) * 100;
}

export function maxLoss(premium: number, shares: number, feeBps: number): number {
  const prem = premium * shares;
  return prem + (prem * feeBps) / 10_000;
}

export function inTheMoney(side: Side, strike: number, mark: number): boolean {
  return side === "call" ? mark > strike : mark < strike;
}

/** What exercising requires, in plain words, for `shares` of a term. */
export function exerciseWords(side: Side, strike: number, shares: number, symbol: string, fmt: (v: number) => string): string {
  const cash = fmt(strike * shares);
  return side === "call" ? `pay $${cash} USDC, receive ${shares} ${symbol}` : `deliver ${shares} ${symbol}, receive $${cash} USDC`;
}

/** The underwriter's side: what is locked and what is collected. */
export function commitMath(side: Side, strike: number, ask: number, shares: number) {
  const locked = side === "call" ? shares : strike * shares;
  const premium = ask * shares;
  const effective = side === "call" ? strike + ask : strike - ask;
  return { locked, premium, effective };
}

/** Premium at a size from the ladder: the smallest rung at or above the size, or the top rung. Null ask means not fillable. */
export function askAtSize(term: Term, shares: number): { ask: number | null; underwriters: number } {
  const rung = term.ladder.find((r) => shares <= r.size) ?? term.ladder[term.ladder.length - 1];
  return rung ? { ask: rung.ask, underwriters: rung.underwriters } : { ask: term.ask, underwriters: 1 };
}

/**
 * Walk the asks for `lots` lots, cheapest first, the way `buy` does on-chain (CLAUDE.md addendum D): total premium in
 * USDC micro, the number of writers touched, and whether the size is fillable at all.
 */
export function walkAsks(asks: { askPerLot: bigint | string; remainingLots6: bigint | string; writerSlot: number }[], lots6: bigint, maxAsks = 8): { premium: bigint; writers: number; filled: bigint; fillable: boolean } {
  const sorted = asks.map((a) => ({ askPerLot: BigInt(a.askPerLot), remainingLots6: BigInt(a.remainingLots6), writerSlot: a.writerSlot })).sort((a, b) => (a.askPerLot < b.askPerLot ? -1 : a.askPerLot > b.askPerLot ? 1 : 0));
  let left = lots6;
  let premium = 0n;
  const touched = new Set<number>();
  for (const a of sorted.slice(0, maxAsks)) {
    if (left === 0n) break;
    const take = a.remainingLots6 < left ? a.remainingLots6 : left;
    premium += (take * a.askPerLot) / 1_000_000n;
    touched.add(a.writerSlot);
    left -= take;
  }
  return { premium, writers: touched.size, filled: lots6 - left, fillable: left === 0n };
}

/** Taker fee in USDC micro, rounded up as the program does. */
export function feeCeil(premiumMicro: bigint, feeBps: number): bigint {
  return (premiumMicro * BigInt(feeBps) + 9_999n) / 10_000n;
}

/** Lots (1e6 per lot) to shares under the multiplier, to four decimals: a lot count is exact, shares are for reading. */
export function sharesOf(lots6: string | bigint, multiplier: number): number {
  return Math.round((Number(lots6) / 1e6) * (multiplier || 1) * 1e4) / 1e4;
}

/** Lots (1e6 per lot) for a number of shares under the market multiplier: one lot is one underlying token. */
export function lots6ForShares(shares: number, multiplier: number): bigint {
  return BigInt(Math.round((shares / (multiplier || 1)) * 1e6));
}

/** The exact cost of `shares` on a term the way `buy` computes it: premium, fee, total, writers touched. USD numbers for display. */
export function costOf(term: Term, shares: number, multiplier: number, feeBps: number): { lots6: bigint; premium: number; fee: number; total: number; writers: number; fillable: boolean; maxPremiumPerLot: bigint } {
  const lots6 = lots6ForShares(shares, multiplier);
  const w = walkAsks(term.asks, lots6);
  const fee = feeCeil(w.premium, feeBps);
  const worst = term.asks.reduce((a, x) => (BigInt(x.askPerLot) > a ? BigInt(x.askPerLot) : a), 0n);
  return { lots6, premium: Number(w.premium) / 1e6, fee: Number(fee) / 1e6, total: Number(w.premium + fee) / 1e6, writers: w.writers, fillable: w.fillable, maxPremiumPerLot: worst };
}
