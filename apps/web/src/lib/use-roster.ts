"use client";

import { fetchJson } from "@/lib/fetch-json";
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
    // Retries on a failed or still-reconnecting answer; the last good data stays on screen through a slow moment.
    fetchJson<RosterData>(q.size ? `/api/roster?${q.toString()}` : "/api/roster", { settled: (d) => d.markets.length > 0 || !/reconnecting/i.test(d.source ?? "") })
      .then((j) => { setData(j); setError(null); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [market]);
  useEffect(() => {
    load();
    // Quotes move once a tick; refresh in the background while the tab is visible so figures never go stale.
    const h = setInterval(() => { if (document.visibilityState === "visible") load(); }, 20_000);
    return () => clearInterval(h);
  }, [load]);
  return { data, error, reload: load };
}
