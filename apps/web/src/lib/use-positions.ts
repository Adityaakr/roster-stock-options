"use client";

import { fetchJson } from "@/lib/fetch-json";
import { useCallback, useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import type { Position, Receipt } from "./model";

/**
 * The connected wallet's positions across every market, from the indexer. Robust the same way as the roster:
 * the last good answer stays on screen through a failed refresh, a failure retries on its own with backoff, an error
 * is surfaced only after three failures in a row (and retrying continues behind it), and the list refreshes every
 * thirty seconds while the tab is visible. `positions` is null only while the first answer for this wallet is loading.
 */
export function usePositions(): { positions: Position[] | null; history: Receipt[]; error: string | null; loading: boolean; reload: () => void; wallet: string | null } {
  const { publicKey } = useWallet();
  const wallet = publicKey?.toBase58() ?? null;
  const [positions, setPositions] = useState<Position[] | null>(null);
  const [history, setHistory] = useState<Receipt[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const failures = useRef(0);
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const again = useRef<() => void>(() => undefined);

  const load = useCallback(() => {
    if (!wallet) {
      // Settle the empty state asynchronously so an effect never sets state synchronously (react-hooks rule).
      Promise.resolve().then(() => { setPositions([]); setHistory([]); setError(null); setLoading(false); });
      return;
    }
    Promise.resolve().then(() => setLoading(true));
    fetchJson<{ positions: Position[]; history: Receipt[] }>(`/api/positions/${wallet}`, { timeoutMs: 35_000 })
      .then((j) => { failures.current = 0; setPositions(j.positions); setHistory(j.history ?? []); setError(null); })
      .catch((e: unknown) => {
        failures.current += 1;
        if (failures.current >= 3) setError(e instanceof Error ? e.message : String(e));
        if (retry.current) clearTimeout(retry.current);
        retry.current = setTimeout(() => again.current(), Math.min(30_000, 3_000 * 2 ** (failures.current - 1)));
      })
      .finally(() => setLoading(false));
  }, [wallet]);

  useEffect(() => {
    again.current = () => load();
    failures.current = 0;
    // A different wallet starts from nothing rather than showing the previous wallet's positions.
    Promise.resolve().then(() => { setPositions(null); setHistory([]); setError(null); });
    load();
    const h = setInterval(() => { if (document.visibilityState === "visible") load(); }, 30_000);
    return () => { clearInterval(h); if (retry.current) clearTimeout(retry.current); };
  }, [load]);

  return { positions, history, error, loading, reload: load, wallet };
}
