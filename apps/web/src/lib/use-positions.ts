"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import type { Position, Receipt } from "./model";

/** The connected wallet's positions across every market, from the indexer. Empty and idle without a wallet. */
export function usePositions(): { positions: Position[] | null; history: Receipt[]; error: string | null; reload: () => void; wallet: string | null } {
  const { publicKey } = useWallet();
  const wallet = publicKey?.toBase58() ?? null;
  const [positions, setPositions] = useState<Position[] | null>(null);
  const [history, setHistory] = useState<Receipt[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    if (!wallet) { setPositions([]); setHistory([]); return; }
    fetch(`/api/positions/${wallet}`, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as { positions: Position[]; history: Receipt[] };
      })
      .then((j) => { setPositions(j.positions); setHistory(j.history ?? []); setError(null); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [wallet]);
  useEffect(() => { load(); }, [load]);
  return { positions, history, error, reload: load, wallet };
}
