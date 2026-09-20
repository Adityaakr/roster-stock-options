"use client";

import Link from "next/link";
import { MarketList } from "@/components/market-list";
import { Badge, ErrorState, Loading, Stat } from "@/components/ui";
import { usd0 } from "@/lib/format";
import { SESSION_LABEL } from "@/lib/model";
import { useRoster } from "@/lib/use-roster";

/** Markets: every listed name by executable depth. A row opens the market. Wallet not required. */
export default function MarketsPage() {
  const { data, error } = useRoster();
  if (error) return <ErrorState message={`Could not read the markets: ${error}`} next="Reload the page. If it persists, the app's RPC is unreachable." />;
  if (!data) return <Loading what="markets" />;
  const depth = data.markets.reduce((a, m) => a + m.depthUsdc, 0);
  const quoting = data.markets.filter((m) => m.bestAsk !== null).length;
  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="h3">Markets</h1>
          <p className="body-sm">Every listed market by executable depth. Open a name for its chart, terms, roster and the wrapper&apos;s rights profile.</p>
        </div>
      <Link href="/ask" className="card askline" data-testid="ask-line"><span className="glyph" aria-hidden>✦</span><span>Not sure which term? <b>Say what you want in a sentence</b> and get the ticket: market, expiry, size, max loss.</span><span className="arrow" aria-hidden>→</span></Link>
        <Badge tone={data.session === "regular" ? "green" : "amber"} dot>{SESSION_LABEL[data.session]}</Badge>
      </div>
      <div className="grid-4" style={{ marginBottom: 16 }}>
        <Stat k="Listed markets" v={String(data.markets.length)} s={`${data.markets.filter((m) => m.tier === 1).length} in Tier 1`} />
        <Stat k="Quoting now" v={String(quoting)} s="with a resident ask" />
        <Stat k="Executable depth" v={`$${usd0(depth)}`} s="USDC fillable across every live term" />
        <Stat k="Live series" v={String(data.markets.reduce((a, m) => a + m.liveSeries, 0))} s="capped per market" />
      </div>
      {data.blocked && data.cluster !== "fixture" ? <div className="card pad msg" role="status" style={{ padding: "12px 16px", marginBottom: 16, color: "var(--amber)" }}>The quoter is blocked on {data.blocked}; asks shown are the ones resident on-chain. Operators: docs/OPERATOR.md.</div> : null}
      <MarketList markets={data.markets} maxHeight={680} />
    </div>
  );
}
