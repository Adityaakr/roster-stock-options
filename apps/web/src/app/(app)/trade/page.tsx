"use client";

import { DiscoverTable } from "@/components/discover-table";
import { Badge, ErrorState, Loading, Stat } from "@/components/ui";
import { usd, dayLabel, countdown } from "@/lib/format";
import { SESSION_LABEL } from "@/lib/model";
import { useRoster } from "@/lib/use-roster";

/** Discover: live terms for NVDAx grouped by expiry (CLAUDE.md 5). Wallet not required. */
export default function TradePage() {
  const { data, error } = useRoster();
  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="h3">Terms</h1>
          <p className="body-sm">Every live term on NVDAx. Pick a side, set a size, and select a row to see the payoff and the quote that backs it.</p>
        </div>
        {data ? <Badge tone={data.session === "regular" ? "green" : "amber"} dot>{SESSION_LABEL[data.session]}</Badge> : null}
      </div>
      {error ? <ErrorState message={`Could not read the terms: ${error}`} next="Reload the page. If it persists, the app's RPC is unreachable." /> : null}
      {!data && !error ? <Loading what="terms" /> : null}
      {data ? (
        <>
          <div className="grid-4" style={{ marginBottom: 16 }}>
            <Stat k={`${data.underlying.symbol} mark, token feed`} v={`$${usd(data.underlying.mark)}`} s={data.underlying.equityMark ? `NVDA equity $${usd(data.underlying.equityMark)}` : "equity feed closed"} />
            <Stat k="Token vs share basis" v={data.underlying.basisBps === null ? "n/a" : `${data.underlying.basisBps >= 0 ? "+" : ""}${data.underlying.basisBps} bps`} s={data.underlying.basisBps === null ? "shown when the equity feed is open" : "token minus share, per Pyth"} />
            <Stat k="Nearest expiry" v={data.expiries[0] ? dayLabel(data.expiries[0]) : "n/a"} s={data.expiries[0] ? `in ${countdown(data.expiries[0], data.nowTs)}` : undefined} />
            <Stat k="Multiplier" v={`${data.underlying.multiplier.toFixed(4)}×`} s={data.underlying.pendingActivationTs ? "activation pending" : "no activation pending"} />
          </div>
          {data.underlying.pendingActivationTs ? <div className="card pad msg" role="status" style={{ padding: "12px 16px", marginBottom: 16, color: "var(--amber)" }}>A multiplier activation is scheduled. Quotes widen or pause for 15 minutes either side of it.</div> : null}
          <DiscoverTable data={data} />
          <p className="small" style={{ marginTop: 14 }}>{data.source}</p>
        </>
      ) : null}
    </div>
  );
}
