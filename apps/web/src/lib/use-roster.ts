"use client";

import { fetchJson } from "@/lib/fetch-json";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RosterData } from "./model";

/** An answer the services could not fill: the web app's offline fallback while market data reconnects. */
export function isReconnecting(d: RosterData | null): boolean {
  return !!d && d.markets.length === 0 && /reconnecting/i.test(d.source ?? "");
}

/**
 * The one read every app screen makes. Robust by construction:
 * - a reconnecting answer or a failed refresh never replaces data already on screen;
 * - while nothing good has arrived yet, it retries every few seconds instead of waiting for the slow refresh;
 * - an error is surfaced only when there is nothing to show at all.
 */
export function useRoster(market?: string | null): { data: RosterData | null; error: string | null; reconnecting: boolean; reload: (fresh?: boolean) => void } {
  const [data, setData] = useState<RosterData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const good = useRef(false);
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failures = useRef(0);
  // Retries call the latest `load` through this ref, so the callback never refers to itself.
  const again = useRef<() => void>(() => undefined);

  // `fresh` reads the chosen market's series from chain instead of the indexer's last snapshot: right after a transaction.
  const load = useCallback((fresh = false) => {
    const q = new URLSearchParams();
    if (market) q.set("m", market);
    if (fresh) q.set("fresh", "1");
    fetchJson<RosterData>(q.size ? `/api/roster?${q.toString()}` : "/api/roster", { settled: (d) => !isReconnecting(d) })
      .then((j) => {
        if (!isReconnecting(j)) { good.current = true; failures.current = 0; setData(j); setError(null); return; }
        // Keep what is on screen; with nothing yet, show the reconnecting state and try again soon.
        if (!good.current) setData(j);
        if (retry.current) clearTimeout(retry.current);
        retry.current = setTimeout(() => again.current(), 4_000);
      })
      .catch((e: unknown) => {
        if (good.current) return;
        // Only after several failures in a row does the page show an error, and it keeps retrying behind it.
        failures.current += 1;
        if (failures.current >= 4) setError(e instanceof Error ? e.message : String(e));
        if (retry.current) clearTimeout(retry.current);
        retry.current = setTimeout(() => again.current(), 6_000);
      });
  }, [market]);

  useEffect(() => {
    again.current = () => load();
    good.current = false;
    failures.current = 0;
    load();
    // Quotes move once a tick; refresh in the background while the tab is visible so figures never go stale.
    const h = setInterval(() => { if (document.visibilityState === "visible") load(); }, 20_000);
    const onVisible = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(h); document.removeEventListener("visibilitychange", onVisible); if (retry.current) clearTimeout(retry.current); };
  }, [load]);

  // A reconnecting answer is never handed to a page: every page shows its loading state for `null` while this retries.
  const ready = data && !isReconnecting(data) ? data : null;
  return { data: ready, error: ready ? null : error, reconnecting: isReconnecting(data), reload: load };
}
