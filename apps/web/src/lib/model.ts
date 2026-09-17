/*
 * The contract model the app renders. Every contract is two integers on-chain, raw_qty and total_strike (CLAUDE.md 4.1);
 * everything here is the display layer over those two numbers: shares = raw_qty x multiplier, strike per share =
 * total_strike / shares. The quoter prices in per-share terms against Pyth; the program never reads either.
 */

export type Side = "call" | "put";
export type Session = "regular" | "pre" | "post" | "overnight" | "closed";

export interface Term {
  /** Stable id used in URLs: `${side}-${strike}-${expiryTs}`. */
  id: string;
  side: Side;
  /** Display strike per share, USD. */
  strike: number;
  /** Unix seconds, 16:00 New York on a Friday. */
  expiryTs: number;
  /** Best ask, premium per share in USD, at the smallest quoted size. */
  ask: number;
  /** Quoted premium per share at three sizes, ascending. Wider sizes pay more. */
  ladder: { size: number; ask: number; underwriters: number }[];
  /** Shares still fillable at any price. */
  capacity: number;
  /** Shares filled so far at this term. */
  openInterest: number;
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

export interface Underlying {
  symbol: "NVDAx";
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
  nowTs: number;
  session: Session;
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

export function termId(side: Side, strike: number, expiryTs: number): string {
  return `${side}-${strike}-${expiryTs}`;
}

export function parseTermId(id: string): { side: Side; strike: number; expiryTs: number } | null {
  const m = id.match(/^(call|put)-(\d+(?:\.\d+)?)-(\d+)$/);
  if (!m) return null;
  return { side: m[1] as Side, strike: Number(m[2]), expiryTs: Number(m[3]) };
}

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

/** Premium at a size from the ladder: the smallest rung at or above the size, or the top rung. */
export function askAtSize(term: Term, shares: number): { ask: number; underwriters: number } {
  const rung = term.ladder.find((r) => shares <= r.size) ?? term.ladder[term.ladder.length - 1];
  return rung ? { ask: rung.ask, underwriters: rung.underwriters } : { ask: term.ask, underwriters: 1 };
}
