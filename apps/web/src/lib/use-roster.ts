"use client";

import { useCallback, useEffect, useState } from "react";
import type { RosterData } from "./model";

/** The one read every app screen makes. Plain fetch and state, as the reference does it; no cache library. */
export function useRoster(market?: string | null): { data: RosterData | null; error: string | null; reload: () => void } {
  const [data, setData] = useState<RosterData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    fetch(market ? `/api/roster?m=${encodeURIComponent(market)}` : "/api/roster", { cache: "no-store" })
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
