"use client";

import { useCallback, useEffect, useState } from "react";
import type { RosterData } from "./model";

/** The one read every app screen makes. Plain fetch and state, as the reference does it; no cache library. */
export function useRoster(market?: string | null): { data: RosterData | null; error: string | null; reload: (fresh?: boolean) => void } {
  const [data, setData] = useState<RosterData | null>(null);
  const [error, setError] = useState<string | null>(null);
  // `fresh` reads the chosen market's series from chain instead of the indexer's last snapshot: right after a transaction.
  const load = useCallback((fresh = false) => {
    const q = new URLSearchParams();
    if (market) q.set("m", market);
    if (fresh) q.set("fresh", "1");
    fetch(q.size ? `/api/roster?${q.toString()}` : "/api/roster", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as RosterData;
      })
      .then((j) => { setData(j); setError(null); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [market]);
  useEffect(() => { load(); }, [load]);
  return { data, error, reload: load };
}
