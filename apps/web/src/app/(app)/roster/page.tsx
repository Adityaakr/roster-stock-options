"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Address, Badge, ErrorState, Loading, Stat } from "@/components/ui";
import { useCluster, explorerUrl } from "@/lib/cluster";
import { usd, usd0, usdK, dayLabel, timeLabel } from "@/lib/format";
import { productName, TIER_LABEL } from "@/lib/model";
import type { ServicesVault } from "@/lib/services";
import { useRoster } from "@/lib/use-roster";

/*
 * Roster (CLAUDE.md 5, Part 2 section 6): protocol-wide executable protection. Totals, per market, then the chosen
 * market's terms with quotes at three sizes, reserved capital with the escrow accounts, capacity, and every exercise
 * including the ones that declined.
 */
export default function RosterPage() {
  return (
    <Suspense fallback={<Loading what="the roster" />}>
      <RosterInner />
    </Suspense>
  );
}

function RosterInner() {
  const params = useSearchParams();
  const { data, error } = useRoster(params.get("m"));
  const cluster = useCluster();
  const router = useRouter();
  if (error) return <ErrorState message={`Could not read the roster: ${error}`} next="Reload the page." />;
  if (!data) return <Loading what="the roster" />;
  const sym = data.underlying.symbol;
  const capacity = data.terms.reduce((a, t) => a + t.capacity, 0);
  const oi = data.terms.reduce((a, t) => a + t.openInterest, 0);
  const depthAll = data.markets.reduce((a, m) => a + m.depthUsdc, 0);
  const liveAll = data.markets.reduce((a, m) => a + m.liveSeries, 0);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="h3">Roster</h1>
          <p className="body-sm">The standing list of who is committed, protocol-wide and per market: capital locked, quotes live, and every exercise, including the ones that failed.</p>
        </div>
        <Badge tone={data.underwriters.some((u) => u.live) ? "green" : "amber"} dot>{data.underwriters.filter((u) => u.live).length} underwriters live on {sym}</Badge>
      </div>

      <div className="grid-4" style={{ marginBottom: 16 }}>
        <Stat k="Executable depth, all markets" v={`$${usd0(depthAll)}`} s={`${data.markets.length} listed market${data.markets.length === 1 ? "" : "s"}`} />
        <Stat k="Live series" v={String(liveAll)} s="capped per market so the book cannot sprawl" />
        <Stat k={`Fillable now, ${sym}`} v={`${Math.floor(capacity)} ${sym}`} s="across every live term" />
        <Stat k={`Open interest, ${sym}`} v={`${Math.floor(oi)} ${sym}`} s="filled and not yet exercised" />
      </div>

      <div className="card scroll-x" style={{ marginBottom: 16 }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--line)" }}>
          <div className="h6">Per market</div>
          <div className="small" style={{ marginTop: 4 }}>Executable depth in USDC, live series against the cap, and the tier that sets who quotes.</div>
        </div>
        <table className="table">
          <thead><tr><th>Market</th><th className="num">Depth</th><th className="num">Series</th><th className="num">Best ask</th><th>Tier</th></tr></thead>
          <tbody>
            {data.markets.map((m) => (
              <tr key={m.symbol} className="row-link" onClick={() => router.push(`/roster?m=${m.symbol}`)} aria-current={m.symbol === sym ? "true" : undefined} style={m.symbol === sym ? { background: "var(--inset)" } : undefined}>
                <td><div style={{ fontWeight: 500 }}>{m.symbol} <span className="small muted" style={{ fontWeight: 400 }}>{m.name}</span></div></td>
                <td className="num">${usd0(m.depthUsdc)}</td>
                <td className="num">{m.liveSeries} / {m.maxLiveSeries}</td>
                <td className="num">{m.bestAsk === null ? <span className="muted">none</span> : `$${usd(m.bestAsk)}`}</td>
                <td><Badge tone={m.tier === 1 ? "green" : m.tier === 2 ? "blue" : undefined}>{TIER_LABEL[m.tier]}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card scroll-x" style={{ marginBottom: 16 }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--line)" }}>
          <div className="h6">{sym}: quotes at three sizes</div>
          <div className="small" style={{ marginTop: 4 }}>Each ask is executable at the size shown and backed by escrow. Wider sizes pay more; a dash means that size is not fillable right now.</div>
        </div>
        <table className="table">
          <thead>
            <tr><th>Term</th><th className="num">10 {sym}</th><th className="num">50 {sym}</th><th className="num">200 {sym}</th><th className="num">Fillable</th><th className="num">Open</th><th>Escrow</th></tr>
          </thead>
          <tbody>
            {data.terms.length === 0 ? <tr><td colSpan={7} className="muted">No live terms on this market.</td></tr> : data.terms.map((t) => (
              <tr key={t.id} className="row-link" onClick={() => router.push(`/trade/${t.id}`)}>
                <td><div style={{ fontWeight: 500 }}>{productName(t.side)} ${usdK(t.strike)}</div><div className="small mono">{dayLabel(t.expiryTs)}{t.halted ? " · halted" : ""}</div></td>
                {t.ladder.map((r) => <td key={r.size} className="num">{r.ask === null ? <span className="muted">–</span> : <>${usd(r.ask)} <span className="small muted">×{r.underwriters}</span></>}</td>)}
                <td className="num">{Math.floor(t.capacity)}</td>
                <td className="num">{Math.floor(t.openInterest)}</td>
                <td className="small" onClick={(e) => e.stopPropagation()}>{t.escrow ? <Address value={t.escrow.collateralVault} href={explorerUrl(cluster, "address", t.escrow.collateralVault)} /> : <span className="muted">linked at deploy</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid-2 split-right">
        <div className="card">
          <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--line)" }}>
            <div className="h6">Reserved capital on {sym}</div>
            <div className="small" style={{ marginTop: 4 }}>Quoted and backed by the writer&apos;s own deposit in the series vault.</div>
          </div>
          <table className="table">
            <thead><tr><th>Underwriter</th><th className="num">USDC</th><th className="num">{sym}</th><th>Account</th></tr></thead>
            <tbody>
              {data.underwriters.length === 0 ? <tr><td colSpan={4} className="muted">No underwriter has quoted this market yet.</td></tr> : data.underwriters.map((u) => (
                <tr key={u.name}>
                  <td><div className="flex items-center gap-2">{u.name} <Badge tone={u.live ? "green" : "amber"} dot>{u.live ? "live" : "idle"}</Badge></div></td>
                  <td className="num">${usd0(u.usdcReserved)}</td>
                  <td className="num">{Math.floor(u.underlyingReserved)}</td>
                  <td className="small">{u.account ? <Address value={u.account} href={explorerUrl(cluster, "address", u.account)} /> : <span className="mono">linked at deploy</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ padding: "12px 20px" }}>
            <div className="bar" role="img" aria-label={`Capacity used: ${Math.floor(oi)} of ${Math.floor(oi + capacity)}`}>
              <span style={{ width: `${(oi / Math.max(1, oi + capacity)) * 100}%`, background: "var(--ink)" }} />
            </div>
            <div className="small" style={{ marginTop: 6 }}>{Math.floor(oi)} {sym} open of {Math.floor(oi + capacity)} {sym} committed. USDC reserved backs Floors; {sym} reserved backs Gaps.</div>
          </div>
        </div>
        <div className="card">
          <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--line)" }}>
            <div className="h6">Exercise history</div>
            <div className="small" style={{ marginTop: 4 }}>Every exercise and auto-exercise on {sym} with its signature, including the ones that declined.</div>
          </div>
          <div className="scroll-x">
            <table className="table">
              <thead><tr><th>When</th><th>Event</th><th className="num">Size</th><th>Result</th></tr></thead>
              <tbody>
                {data.exercises.length === 0 ? <tr><td colSpan={4} className="muted">No exercises yet on this cluster.</td></tr> : data.exercises.map((e, i) => (
                  <tr key={i}>
                    <td className="small mono">{timeLabel(e.ts)}</td>
                    <td><div className="flex items-center gap-2">{e.kind === "auto_exercise" ? "Auto-exercise" : e.kind === "release" ? "Release" : "Exercise"} <Badge tone={e.ok ? "green" : "amber"} dot>{e.ok ? "settled" : "declined"}</Badge></div><div className="small">{e.note}</div></td>
                    <td className="num">{e.shares} {sym}</td>
                    <td className="small">{e.signature ? <Address value={e.signature} n={6} href={explorerUrl(cluster, "tx", e.signature)} /> : <span className="mono">no signature on this cluster</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <VaultLedger nowTs={data.nowTs} decimalsOf={(symbol) => data.markets.find((m) => m.symbol === symbol)?.decimals ?? 8} />
      <div className="card pad flex items-center justify-between gap-4 flex-wrap" style={{ marginTop: 16 }}>
        <div>
          <div className="h6">Want to be on the roster?</div>
          <div className="small" style={{ marginTop: 4 }}>Lock USDC or {sym}, publish an ask, get paid when it fills. Paid risk, disclosed as such.</div>
        </div>
        <Link href={`/underwrite?m=${sym}`} className="btn primary">Underwrite a term</Link>
      </div>
      <p className="small" style={{ marginTop: 14 }}>{data.source}</p>
    </div>
  );
}

/*
 * The vaults' own ledger (Part 3 section 6): every epoch of every vault, its sign included, from the first one. A
 * vault that is short volatility with no hedge will have losing epochs, and a venue that publishes them is the one
 * that keeps its depositors when they come.
 */
function VaultLedger({ nowTs, decimalsOf }: { nowTs: number; decimalsOf: (symbol: string) => number }) {
  const [vaults, setVaults] = useState<ServicesVault[]>([]);
  useEffect(() => {
    fetch("/api/vaults", { cache: "no-store" }).then((r) => (r.ok ? (r.json() as Promise<ServicesVault[] | { error: string }>) : [])).then((j) => { if (Array.isArray(j)) setVaults(j); }).catch(() => undefined);
  }, []);
  if (!vaults.length) return null;
  const rows = vaults.flatMap((v) => v.epochs.map((e) => ({ v, e })));
  const totalPremium = vaults.reduce((a, v) => a + v.epochs.reduce((b, e) => b + Number(e.premiumIn), 0) + Number(v.epochPremiumIn), 0) / 1e6;
  const totalBuyback = vaults.reduce((a, v) => a + v.epochs.reduce((b, e) => b + Number(e.buybackOut), 0) + Number(v.epochBuybackOut), 0) / 1e6;
  const losing = rows.filter(({ e }) => Number(e.pnlPerShare1e6) < 0).length;
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--line)" }} className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="h6">The vaults, epoch by epoch</div>
          <div className="small muted">Short volatility with no hedge: losing epochs are published like any other. {rows.length} rolled so far, {losing} of them losing.</div>
        </div>
        <div className="flex items-center gap-4">
          <Stat k="Premium collected" v={`$${usd(totalPremium)}`} />
          <Stat k="Paid on buybacks" v={`$${usd(totalBuyback)}`} />
          <Link href="/vaults" className="btn secondary sm">Deposit</Link>
        </div>
      </div>
      {rows.length === 0 ? <p className="small muted" style={{ padding: "12px 20px" }}>No epoch has rolled yet; the next rolls at {timeLabel(Math.min(...vaults.map((v) => v.nextRollTs)))}, in {Math.max(0, Math.round((Math.min(...vaults.map((v) => v.nextRollTs)) - nowTs) / 60))} minutes.</p> : (
        <table className="table">
          <thead><tr><th>Vault</th><th>Epoch</th><th>Rolled</th><th className="num">Premium in</th><th className="num">Buybacks</th><th className="num">Assigned</th><th className="num">P&amp;L per share</th><th className="num">Shares after</th></tr></thead>
          <tbody>
            {rows.sort((a, b) => b.e.rolledAt - a.e.rolledAt).map(({ v, e }) => {
              const cc = v.kind === "covered_call";
              const unit = cc ? v.symbol : "USDC";
              const pnl = Number(e.pnlPerShare1e6) / 1e6 / (cc ? 10 ** decimalsOf(v.symbol) / 1e6 : 1);
              return (
                <tr key={`${v.address}-${e.epoch}`}>
                  <td>{cc ? "Covered Call" : "Cash-Secured Put"} · {v.symbol} <Badge tone={v.halted ? "amber" : "green"} dot>{v.halted ? "halted" : "quoting"}</Badge></td>
                  <td className="mono">{e.epoch}</td>
                  <td>{timeLabel(e.rolledAt)}</td>
                  <td className="num">${usd(Number(e.premiumIn) / 1e6)}</td>
                  <td className="num">${usd(Number(e.buybackOut) / 1e6)}</td>
                  <td className="num">{usdK(Number(e.assignedLots6) / 1e6)} lots</td>
                  <td className={`num ${pnl < 0 ? "down" : pnl > 0 ? "up" : ""}`}>{pnl === 0 ? "0" : `${pnl > 0 ? "+" : "−"}${Math.abs(pnl).toFixed(6)} ${unit}`}</td>
                  <td className="num">{usdK(Number(e.totalSharesAfter) / 1e6)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
