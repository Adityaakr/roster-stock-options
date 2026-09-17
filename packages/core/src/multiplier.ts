/*
 * xStocks scaled UI amount: raw balances never change, a multiplier in the mint extension converts raw to displayed
 * share-equivalents. The effective value is `new_multiplier` once `now >= new_multiplier_effective_timestamp`, else
 * `multiplier` (spl-token-2022-interface 2.1.0, extension/scaled_ui_amount/mod.rs). The JS getter returns the raw
 * fields only; this applies the rule. Verified equal to the xStocks API `currentMultiplier` on all 11 launch mints.
 */
export interface ScaledUiConfig {
  multiplier: number;
  newMultiplier: number;
  newMultiplierEffectiveTimestamp: bigint | number;
}

export function effectiveMultiplier(cfg: ScaledUiConfig, nowUnix: number): number {
  const ts = Number(cfg.newMultiplierEffectiveTimestamp);
  return ts > 0 && nowUnix >= ts ? cfg.newMultiplier : cfg.multiplier;
}

/** True inside the window xStocks asks venues to pause around an activation (15 minutes either side). */
export function inActivationWindow(cfg: ScaledUiConfig, nowUnix: number, windowSecs = 15 * 60): boolean {
  const ts = Number(cfg.newMultiplierEffectiveTimestamp);
  return ts > 0 && Math.abs(nowUnix - ts) <= windowSecs;
}
