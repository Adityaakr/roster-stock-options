"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { DiscoverTable } from "@/components/discover-table";
import { MarketList } from "@/components/market-list";
import { Badge, ErrorState, Loading, Stat } from "@/components/ui";
import { usd, dayLabel, countdown } from "@/lib/format";
import { SESSION_LABEL, TIER_LABEL } from "@/lib/model";
import { useRoster } from "@/lib/use-roster";

/** Discover: every listed market by executable depth, then the live terms of the chosen one (CLAUDE.md 5, Part 2 section 6). Wallet not required. */
export default function TradePage() {
  return (
    <Suspense fallback={<Loading what="terms" />}>
      <TradeInner />
    </Suspense>
  );
}

function TradeInner() {
  const params = useSearchParams();
  const wanted = params.get("m");
  const { data, error } = useRoster(wanted);
  const u = data?.underlying;
  const m = data?.markets.find((x) => x.symbol === u?.symbol);
  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="h3">Terms</h1>
          <p className="body-sm">Every listed market by executable depth. Pick a name, then a side, set a size, and select a row to see the payoff and the quote that backs it.</p>
        </div>
        {data ? <Badge tone={data.session === "regular" ? "green" : "amber"} dot>{SESSION_LABEL[data.session]}</Badge> : null}
      </div>
      {error ? <ErrorState message={`Could not read the terms: ${error}`} next="Reload the page. If it persists, the app's RPC is unreachable." /> : null}
      {!data && !error ? <Loading what="terms" /> : null}
      {data && u && m ? (
        <>
          <MarketList markets={data.markets} selected={u.symbol} />
          {data.blocked && data.cluster !== "fixture" ? <div className="card pad msg" role="status" style={{ padding: "12px 16px", margin: "16px 0", color: "var(--amber)" }}>The quoter is blocked on {data.blocked}; asks shown are the ones resident on-chain. Operators: docs/OPERATOR.md.</div> : null}
          <div className="page-head" style={{ marginTop: 24 }}>
            <div>
              <h2 className="h4">{u.symbol} <span className="muted" style={{ fontWeight: 400 }}>{u.name}</span></h2>
              <p className="body-sm">{TIER_LABEL[m.tier]} · {m.liveSeries} of {m.maxLiveSeries} series live · multiplier {u.multiplier.toFixed(4)}× · {m.hasPermanentDelegate ? "issuer holds a permanent delegate" : "no permanent delegate"}{m.pausable ? ", pausable" : ""}.</p>
            </div>
          </div>
          <div className="grid-4" style={{ marginBottom: 16 }}>
            <Stat k={`${u.symbol} mark, token feed`} v={m.mark === null ? "no feed" : `$${usd(m.mark)}`} s={u.equityMark ? `equity $${usd(u.equityMark)}` : "equity feed closed"} />
            <Stat k="Token vs share basis" v={u.basisBps === null ? "n/a" : `${u.basisBps >= 0 ? "+" : ""}${u.basisBps} bps`} s={u.basisBps === null ? "shown when the equity feed is open" : "token over the share price"} />
            <Stat k="Nearest expiry" v={data.expiries[0] ? dayLabel(data.expiries[0]) : "n/a"} s={data.expiries[0] ? `in ${countdown(data.expiries[0], data.nowTs)}` : undefined} />
            <Stat k="Volatility used" v={`${(m.vol * 100).toFixed(0)}%`} s={m.volSource === "fixture" ? "fixture" : m.volSource} />
          </div>
          {u.pendingActivationTs ? <div className="card pad msg" role="status" style={{ padding: "12px 16px", marginBottom: 16, color: "var(--amber)" }}>A multiplier activation is scheduled for {dayLabel(u.pendingActivationTs)}. Quotes widen or pause around it, and strikes are shown per share at the live multiplier.</div> : null}
          {m.paused ? <div className="card pad msg" role="alert" style={{ padding: "12px 16px", marginBottom: 16, color: "var(--red)" }}>This market is paused by its issuer or the protocol. Nothing can be signed until it resumes; positions keep their rights.</div> : null}
          <DiscoverTable data={data} />
          <p className="small" style={{ marginTop: 14 }}>{data.source}</p>
        </>
      ) : null}
    </div>
  );
}
