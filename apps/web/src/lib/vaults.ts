"use client";

import { useCallback, useEffect, useState } from "react";
import type { ServicesVault } from "./services";
import type { Market } from "./model";

/*
 * The vaults as the app reads them: the services' `/v1/vaults` payload, plus the derived figures every vault screen
 * shows (what is held in each asset, what is locked, the value of a share, the last epoch's result). Amounts here are
 * in display units: tokens for the underlying, USDC for the quote asset, shares with six decimals removed.
 */

export function useVaults(): { vaults: ServicesVault[] | null; error: string | null; reload: () => void } {
  const [vaults, setVaults] = useState<ServicesVault[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    fetch("/api/vaults", { cache: "no-store" })
      .then(async (r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return (await r.json()) as ServicesVault[] | { error: string }; })
      .then((j) => { if (Array.isArray(j)) { setVaults(j); setError(null); } else setError(j.error); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  useEffect(() => { reload(); }, [reload]);
  return { vaults, error, reload };
}

export interface VaultView {
  v: ServicesVault;
  cc: boolean;
  /** "Covered Call" or "Cash-Secured Put". */
  kindLabel: string;
  /** The collateral unit and the other asset's unit, e.g. NVDAx and USDC. */
  unit: string;
  otherUnit: string;
  decimals: number;
  rawPerToken: number;
  /** Collateral belonging to shares: free plus locked, less what is reserved or still queued. */
  collateral: number;
  free: number;
  locked: number;
  other: number;
  /** Value of the other asset in collateral units at the mark. */
  otherInCollateral: number;
  totalShares: number;
  navPerShare: number;
  /** Total value in USD at the mark: collateral plus the other asset. */
  depositsUsd: number | null;
  lockedUsd: number | null;
  pendingDeposit: number;
  pendingWithdrawShares: number;
  capLots: number;
  premiumIn: number;
  buybackOut: number;
  assignedLots: number;
  lastEpoch: ServicesVault["epochs"][number] | null;
  /** Last epoch's P&L per share in the collateral unit, and as a fraction of the value per share going in. */
  lastPnlPerShare: number | null;
  lastPnlPct: number | null;
  mark: number | null;
}

export function vaultView(v: ServicesVault, market: Market | undefined): VaultView {
  const cc = v.kind === "covered_call";
  const decimals = market?.decimals ?? 8;
  const rawPerToken = 10 ** decimals;
  const mult = market?.multiplier ?? 1;
  const mark = market?.mark ?? null;
  const toCollateral = (raw: string) => (cc ? Number(raw) / rawPerToken : Number(raw) / 1e6);
  const toOther = (raw: string) => (cc ? Number(raw) / 1e6 : Number(raw) / rawPerToken);
  const free = toCollateral(v.collateralBalance) - toCollateral(v.reservedCollateralRaw) - toCollateral(v.pendingDepositRaw);
  const locked = toCollateral(v.lockedRaw);
  const collateral = free + locked;
  const other = toOther(v.otherBalance) - toOther(v.reservedOther);
  const otherInCollateral = mark ? (cc ? other / (mark * mult) : other * mark * mult) : 0;
  const totalShares = Number(v.totalShares) / 1e6;
  const navPerShare = totalShares > 0 ? (collateral + otherInCollateral) / totalShares : 1;
  const unitUsd = mark ? (cc ? mark * mult : 1) : null;
  const depositsUsd = unitUsd !== null ? (collateral + otherInCollateral) * unitUsd : null;
  const lockedUsd = unitUsd !== null ? locked * unitUsd : null;
  const lastEpoch = v.epochs.length ? v.epochs[v.epochs.length - 1]! : null;
  const lastPnlPerShare = lastEpoch ? Number(lastEpoch.pnlPerShare1e6) / 1e6 / (cc ? rawPerToken / 1e6 : 1) : null;
  const navBefore = lastEpoch && v.epochs.length > 1 ? Number(v.epochs[v.epochs.length - 2]!.navCollateralRaw) / (cc ? rawPerToken : 1e6) / Math.max(1e-9, Number(v.epochs[v.epochs.length - 2]!.totalSharesAfter) / 1e6) : null;
  const lastPnlPct = lastPnlPerShare !== null && navBefore ? lastPnlPerShare / navBefore : null;
  return {
    v, cc, kindLabel: cc ? "Covered Call" : "Cash-Secured Put", unit: cc ? v.symbol : "USDC", otherUnit: cc ? "USDC" : v.symbol, decimals, rawPerToken,
    collateral, free, locked, other, otherInCollateral, totalShares, navPerShare, depositsUsd, lockedUsd,
    pendingDeposit: toCollateral(v.pendingDepositRaw), pendingWithdrawShares: Number(v.pendingWithdrawShares) / 1e6, capLots: Number(v.capPerSeriesLots6) / 1e6,
    premiumIn: Number(v.epochPremiumIn) / 1e6, buybackOut: Number(v.epochBuybackOut) / 1e6, assignedLots: Number(v.epochAssignedLots6) / 1e6,
    lastEpoch, lastPnlPerShare, lastPnlPct, mark,
  };
}

/** "Sep 20, 21:00" in UTC. */
export function shortWhen(unix: number): string {
  return new Date(unix * 1000).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });
}

/** A signed, compact P&L label with its unit. */
export function pnlLabel(perShare: number | null, unit: string): string {
  if (perShare === null) return "no epoch yet";
  if (perShare === 0) return "0";
  return `${perShare > 0 ? "+" : "−"}${Math.abs(perShare).toFixed(4)} ${unit}`;
}
