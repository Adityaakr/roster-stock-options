"use client";

import { useEffect, useState } from "react";
import type { Side } from "./model";

/** The intent route's answer, as the Ask page reads it. Mirrors `Proposal` in `lib/intent.ts` (server-only). */
export interface Proposal {
  action: "buy_gap" | "buy_floor" | "write_floor" | "write_gap";
  market: { symbol: string; name: string; logo: string | null; mark: number };
  term: { id: string; side: Side; strike: number; expiryTs: number; capacity: number };
  size: number; premium: number; fee: number; total: number; breakEven: number; movePct: number;
  locked: { amount: number; unit: string } | null;
  href: string; explanation: string; caveats: string[];
  intent: {
    action: "buy_gap" | "buy_floor" | "write_floor" | "write_gap" | "unclear";
    market: string | null; sizeShares: number | null; budgetUsdc: number | null;
    horizon: { kind: "nearest" } | { kind: "furthest" } | { kind: "days"; days: number } | { kind: "date"; iso: string };
    strike: "at_the_money" | "cheap" | "tight" | null; strikePct: number | null; note: string;
  };
}

/** null while asking, then whether this deployment has a key. */
export function useIntentEnabled(): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    fetch("/api/intent", { cache: "no-store" }).then((r) => r.json()).then((j: { enabled?: boolean }) => setEnabled(!!j.enabled)).catch(() => setEnabled(false));
  }, []);
  return enabled;
}
