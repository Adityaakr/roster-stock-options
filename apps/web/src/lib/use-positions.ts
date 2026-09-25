"use client";

import { fetchJson } from "@/lib/fetch-json";
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
    if (!wallet) {
      // Settle the empty state asynchronously so an effect never sets state synchronously (react-hooks rule).
      Promise.resolve().then(() => { setPositions([]); setHistory([]); });
      return;
    }
    fetchJson<{ positions: Position[]; history: Receipt[] }>(`/api/positions/${wallet}`)
      .then((j) => { setPositions(j.positions); setHistory(j.history ?? []); setError(null); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [wallet]);
  useEffect(() => { load(); }, [load]);
  return { positions, history, error, reload: load, wallet };
}
