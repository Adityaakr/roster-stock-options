"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import type { Position } from "./model";

/** The connected wallet's positions across every market, from the indexer. Empty and idle without a wallet. */
export function usePositions(): { positions: Position[] | null; error: string | null; reload: () => void; wallet: string | null } {
  const { publicKey } = useWallet();
  const wallet = publicKey?.toBase58() ?? null;
  const [positions, setPositions] = useState<Position[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    if (!wallet) { setPositions([]); return; }
    fetch(`/api/positions/${wallet}`, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as { positions: Position[] };
      })
      .then((j) => { setPositions(j.positions); setError(null); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [wallet]);
  useEffect(() => { load(); }, [load]);
  return { positions, error, reload: load, wallet };
}
