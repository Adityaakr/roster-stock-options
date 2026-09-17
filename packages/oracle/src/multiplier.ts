/*
 * The xStocks multiplier watcher: the pending activation and its reason (dividend or split), from the issuer API,
 * cross-checked against the mint's ScaledUiAmount extension on-chain. Emits the banner state the app shows and the
 * window the quoter widens or pauses in (CLAUDE.md 2.1: 15 minutes either side).
 */
import type { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, getMint, getScaledUiAmountConfig } from "@solana/spl-token";
import { effectiveMultiplier, inActivationWindow } from "@roster/core";

export const XSTOCKS_API = "https://api.xstocks.fi/api/v2";

export interface MultiplierState {
  symbol: string;
  onChain: number;
  api: number | null;
  pendingMultiplier: number | null;
  pendingAt: number | null;
  reason: string | null;
  inWindow: boolean;
  /** Only a dividend raises the value of a raw lot; a split does not (docs/DECISIONS.md). */
  pendingIsDividend: boolean;
  at: number;
}

export async function readMultiplier(connection: Connection, symbol: string, mint: PublicKey, nowUnix = Math.floor(Date.now() / 1000)): Promise<MultiplierState> {
  const m = await getMint(connection, mint, "confirmed", TOKEN_2022_PROGRAM_ID);
  const cfg = getScaledUiAmountConfig(m);
  const onChain = cfg ? effectiveMultiplier({ multiplier: cfg.multiplier, newMultiplier: cfg.newMultiplier, newMultiplierEffectiveTimestamp: cfg.newMultiplierEffectiveTimestamp }, nowUnix) : 1;
  let api: number | null = null;
  let pendingMultiplier: number | null = null;
  let pendingAt: number | null = null;
  let reason: string | null = null;
  try {
    const res = await fetch(`${XSTOCKS_API}/public/assets/${symbol}/multiplier?network=Solana`, { signal: AbortSignal.timeout(8_000) });
    if (res.ok) {
      const j = (await res.json()) as { currentMultiplier: number; newMultiplier: number; activationDateTime: number; reason: string | null };
      api = j.currentMultiplier;
      if (j.activationDateTime && j.activationDateTime > 0) {
        pendingMultiplier = j.newMultiplier;
        pendingAt = j.activationDateTime > 1e12 ? Math.floor(j.activationDateTime / 1000) : j.activationDateTime;
        reason = j.reason;
      }
    }
  } catch {
    // The chain is the truth; the API adds the reason and the pending window.
  }
  const inWindow = cfg ? inActivationWindow({ multiplier: cfg.multiplier, newMultiplier: cfg.newMultiplier, newMultiplierEffectiveTimestamp: cfg.newMultiplierEffectiveTimestamp }, nowUnix) : false;
  return { symbol, onChain, api, pendingMultiplier, pendingAt, reason, inWindow, pendingIsDividend: (reason ?? "").toLowerCase().includes("dividend"), at: nowUnix };
}
