/*
 * Denomination (docs/01-architecture.md section 4). A contract is priced and settled in lots: one lot is 10^decimals raw
 * units of the underlying, one position token (6 dp) is one lot, so `raw = lots6 * 10^(decimals - 6)` is exact for
 * every listed mint (decimals >= 6). The strike is micro-USDC per lot and the program never reads a multiplier; the
 * display strike per share is derived here from the live multiplier.
 */

export const LOT6 = 1_000_000n;
export const USDC_DECIMALS = 6;

/** Raw token units for `lots6` (six-decimal lots) of a mint with `decimals`. Exact; throws below six decimals. */
export function lots6ToRaw(lots6: bigint, decimals: number): bigint {
  if (decimals < 6) throw new Error(`mint has ${decimals} decimals; lots need at least 6`);
  return lots6 * 10n ** BigInt(decimals - 6);
}

export function rawToLots6(raw: bigint, decimals: number): bigint {
  if (decimals < 6) throw new Error(`mint has ${decimals} decimals; lots need at least 6`);
  return raw / 10n ** BigInt(decimals - 6);
}

/** USDC owed by a call holder exercising `lots6`, rounded up (addendum E: the party paying rounds up). */
export function usdcOwedCeil(lots6: bigint, strikeUsdcPerLot: bigint): bigint {
  return (lots6 * strikeUsdcPerLot + LOT6 - 1n) / LOT6;
}

/** USDC paid out for `lots6` (put exercise, call settlement), rounded down. */
export function usdcPaidFloor(lots6: bigint, strikeUsdcPerLot: bigint): bigint {
  return (lots6 * strikeUsdcPerLot) / LOT6;
}

/** Strike per share-equivalent in USD for display: micro-USDC per lot over the live multiplier. */
export function strikePerShare(strikeUsdcPerLot: bigint, multiplier: number): number {
  return Number(strikeUsdcPerLot) / 1e6 / multiplier;
}

/** Micro-USDC per lot for a display strike in USD at the multiplier the quoter chose, truncated (one f64 multiply, as the quoter must reproduce). */
export function strikeUsdcPerLotFromDisplay(strikeUsd: number, multiplier: number): bigint {
  return BigInt(Math.trunc(Math.round(strikeUsd * 1e6) * multiplier));
}
