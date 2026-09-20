"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { MarketLogo } from "@/components/market-list";
import { CountUp } from "@/components/motion";
import { Address, Badge, ErrorState, Loading } from "@/components/ui";
import { useCluster, explorerUrl } from "@/lib/cluster";
import { usd, usd0, usdK, dayLabel, timeLabel, countdown } from "@/lib/format";
import { productName, TIER_LABEL, type RosterData, type Term } from "@/lib/model";
import type { ServicesVault } from "@/lib/services";
import { useRoster } from "@/lib/use-roster";

/*
 * Roster (CLAUDE.md 5, Part 2 section 6, addendum G): the proof of executable protection. The protocol's figures
 * in one strip, every market with its depth drawn and its best ask on each side, then the chosen market as one
 * panel: its terms with quotes at three sizes and the escrow behind each, its underwriters with what they have
 * locked, every exercise with its signature, and the vaults' epochs with their sign. A venue that publishes
 * whether its promises are funded is a venue that expects to be checked.
 */
export default function RosterPage() {
  return (
    <Suspense fallback={<Loading what="the roster" />}>
      <RosterInner />
    </Suspense>
  );
}

type Tab = "terms" | "writers" | "history" | "vaults";

function RosterInner() {
  const params = useSearchParams();
  const { data, error } = useRoster(params.get("m"));
  const cluster = useCluster();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("terms");
  // Null until the vaults answer, so the strip shows a wait rather than a zero that is not true.
  const [vaultsOrNull, setVaults] = useState<ServicesVault[] | null>(null);
  const vaults = useMemo(() => vaultsOrNull ?? [], [vaultsOrNull]);
  const vaultsReady = vaultsOrNull !== null;
  useEffect(() => {
    fetch("/api/vaults", { cache: "no-store" }).then((r) => (r.ok ? (r.json() as Promise<ServicesVault[] | { error: string }>) : [])).then((j) => setVaults(Array.isArray(j) ? j : [])).catch(() => setVaults([]));
  }, []);
  const ledger = useMemo(() => {
    const rows = vaults.flatMap((v) => v.epochs.map((e) => ({ v, e })));
    const premium = vaults.reduce((a, v) => a + v.epochs.reduce((b, e) => b + Number(e.premiumIn), 0) + Number(v.epochPremiumIn), 0) / 1e6;
    const buybacks = vaults.reduce((a, v) => a + v.epochs.reduce((b, e) => b + Number(e.buybackOut), 0) + Number(v.epochBuybackOut), 0) / 1e6;
    const losing = rows.filter(({ e }) => Number(e.pnlPerShare1e6) < 0).length;
    return { rows, premium, buybacks, losing };
  }, [vaults]);

  if (error) return <ErrorState message={`Could not read the roster: ${error}`} next="Reload the page." />;
  if (!data) return <Loading what="the roster" />;
  const sym = data.underlying.symbol;
  const market = data.markets.find((m) => m.symbol === sym);
  const capacity = data.terms.reduce((a, t) => a + t.capacity, 0);
  const oi = data.terms.reduce((a, t) => a + t.openInterest, 0);
  const depthAll = data.markets.reduce((a, m) => a + m.depthUsdc, 0);
  const liveAll = data.markets.reduce((a, m) => a + m.liveSeries, 0);
  const capAll = data.markets.reduce((a, m) => a + m.maxLiveSeries, 0);
  const depthMax = Math.max(...data.markets.map((m) => m.depthUsdc), 0);
  const quoting = data.markets.filter((m) => m.bestAsk !== null).length;
  const liveWriters = data.underwriters.filter((u) => u.live).length;
  const bestOn = (symbol: string, side: "call" | "put") => { const xs = data.ideas.filter((i) => i.market === symbol && i.side === side); return xs.length ? Math.min(...xs.map((i) => i.ask)) : null; };
  const marketVaults = vaults.filter((v) => v.symbol === sym);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Roster</h1>
          <p>The standing list of who is committed: capital locked, quotes live, and every exercise, including the ones that failed. Every figure here is on chain, by account.</p>
        </div>
      </div>

      <div className="card rfigs rfigs-5" style={{ marginBottom: 16 }}>
        <div className="rfig"><div className="k">Executable depth</div><div className="v"><CountUp value={`$${usd0(depthAll)}`} /></div><div className="s">across {data.markets.length} listed market{data.markets.length === 1 ? "" : "s"}</div></div>
        <div className="rfig"><div className="k">Markets quoting</div><div className="v"><CountUp value={String(quoting)} /><span className="unit">of {data.markets.length}</span></div><div className="s">with a resident ask right now</div></div>
        <div className="rfig"><div className="k">Live series</div><div className="v"><CountUp value={String(liveAll)} /><span className="unit">of {capAll}</span></div><div className="s">capped per market so the book cannot sprawl</div></div>
        <div className="rfig"><div className="k">Vault premium collected</div><div className="v">{vaultsReady ? <CountUp value={`$${usd(ledger.premium)}`} /> : <span className="muted">…</span>}</div><div className="s">{vaultsReady ? `$${usd(ledger.buybacks)} paid back on buybacks` : "reading the vaults"}</div></div>
        <div className="rfig"><div className="k">Epochs published</div><div className="v">{vaultsReady ? <><CountUp value={String(ledger.rows.length)} /><span className={`unit ${ledger.losing ? "down" : ""}`}>{ledger.losing} losing</span></> : <span className="muted">…</span>}</div><div className="s">every result with its sign, from the first</div></div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="flex items-center justify-between gap-4 flex-wrap" style={{ padding: "16px 20px", borderBottom: "1px solid var(--line)" }}>
          <div>
            <div className="h6">Every market</div>
            <div className="small muted" style={{ marginTop: 2 }}>Executable depth in USDC, the best ask on each side, live series against the cap, and the tier that sets who quotes. Pick a market for its own roster.</div>
          </div>
          <div className="flex items-center gap-2 small muted flex-wrap"><Badge tone="green">Tier 1</Badge> treasury seeded <Badge tone="blue">Tier 2</Badge> quotes on request <Badge>Tier 3</Badge> permissionless</div>
        </div>
        <div className="scroll-x">
          <table className="table rtable">
            <thead><tr><th>Market</th><th>Depth</th><th className="num">Gap from</th><th className="num">Floor from</th><th className="num hide-sm">Series</th><th className="hide-sm">Tier</th><th aria-label="open"></th></tr></thead>
            <tbody>
              {[...data.markets].sort((a, b) => b.depthUsdc - a.depthUsdc).map((m) => {
                const gap = bestOn(m.symbol, "call");
                const floor = bestOn(m.symbol, "put");
                const nv = vaults.filter((v) => v.symbol === m.symbol).length;
                return (
                  <tr key={m.symbol} className={`rowlink ${m.symbol === sym ? "on" : ""}`} onClick={() => { router.push(`/roster?m=${m.symbol}`); setTab("terms"); }} aria-current={m.symbol === sym ? "true" : undefined}>
                    <td><div className="flex items-center gap-3"><MarketLogo m={m} size={28} /><div><div style={{ fontWeight: 500 }}>{m.symbol}</div><div className="small muted">{m.name}{nv ? ` · ${nv} vault${nv === 1 ? "" : "s"}` : ""}</div></div></div></td>
                    <td>
                      <div className="mono">${usd0(m.depthUsdc)}</div>
                      <div className="bar thin" aria-hidden><span style={{ width: `${Math.max(2, (m.depthUsdc / Math.max(1, depthMax)) * 100)}%` }} /></div>
                    </td>
                    <td className="num mono">{gap === null ? <span className="muted">none</span> : `$${usd(gap)}`}</td>
                    <td className="num mono">{floor === null ? <span className="muted">none</span> : `$${usd(floor)}`}</td>
                    <td className="num hide-sm"><span className="mono">{m.liveSeries}</span> <span className="small muted">/ {m.maxLiveSeries}</span></td>
                    <td className="hide-sm"><Badge tone={m.tier === 1 ? "green" : m.tier === 2 ? "blue" : undefined}>{TIER_LABEL[m.tier]}</Badge></td>
                    <td className="num muted" aria-hidden>→</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <section className="card rpanel">
        <div className="rpanel-head">
          <div className="flex items-center gap-3">
            {market ? <MarketLogo m={market} size={40} /> : null}
            <div>
              <div className="flex items-center gap-2 flex-wrap"><h2 className="h5" style={{ margin: 0 }}>{sym}</h2><Badge tone={liveWriters ? "green" : "amber"} dot>{liveWriters} underwriter{liveWriters === 1 ? "" : "s"} live</Badge>{market ? <Badge tone={market.tier === 1 ? "green" : market.tier === 2 ? "blue" : undefined}>{TIER_LABEL[market.tier]}</Badge> : null}</div>
              <div className="small muted">{market?.name} · mark <span className="mono ink">${usd(market?.mark ?? 0)}</span></div>
            </div>
          </div>
          <div className="rpanel-figs">
            <div><span>Fillable now</span><b className="mono">{Math.floor(capacity)} {sym}</b></div>
            <div><span>Open interest</span><b className="mono">{Math.floor(oi)} {sym}</b></div>
            <div><span>Committed</span><b className="mono">{Math.floor(oi + capacity)} {sym}</b></div>
            <Link href={`/underwrite?m=${sym}`} className="btn primary sm">Earn on {sym}</Link>
          </div>
        </div>
        <div className="rtabs" role="tablist">
          {([["terms", `Terms · ${data.terms.length}`], ["writers", `Underwriters · ${data.underwriters.length}`], ["history", `Exercises · ${data.exercises.length}`], ["vaults", vaultsReady ? `Vaults · ${marketVaults.length}` : "Vaults"]] as [Tab, string][]).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>{label}</button>
          ))}
        </div>

        {tab === "terms" ? <Terms data={data} sym={sym} cluster={cluster} onOpen={(t) => router.push(`/trade/${t.id}`)} /> : null}
        {tab === "writers" ? (
          <div>
            <div className="rcap">
              <div className="flex items-center justify-between small"><span>Capacity used</span><span className="mono">{Math.floor(oi)} of {Math.floor(oi + capacity)} {sym}</span></div>
              <div className="bar thin" style={{ maxWidth: "none", marginTop: 6 }} role="img" aria-label={`Capacity used: ${Math.floor(oi)} of ${Math.floor(oi + capacity)}`}><span style={{ width: `${(oi / Math.max(1, oi + capacity)) * 100}%` }} /></div>
              <div className="small muted" style={{ marginTop: 6 }}>USDC reserved backs Floors; {sym} reserved backs Gaps. Every figure is the writer&apos;s own deposit in the series vault.</div>
            </div>
            {data.underwriters.length === 0 ? <p className="muted" style={{ padding: "16px 20px" }}>No underwriter has quoted this market yet.</p> : (
              <div className="rwriters">
                {data.underwriters.map((u) => {
                  // A vault writes through the same instruction as anyone; here it is named for what it is.
                  const vault = u.account ? vaults.find((v) => v.address === u.account) : undefined;
                  const name = vault ? `${vault.kind === "covered_call" ? "Covered Call" : "Cash-Secured Put"} vault` : u.name;
                  const who = vault ? "depositors' capital, quoted by the vault" : u.kind === "treasury" ? "the protocol's own capital" : u.kind === "maker" ? "the maker bot" : "an external writer";
                  return (
                  <div key={u.name} className="rwriter">
                    <div className="flex items-center justify-between gap-2"><b>{vault ? <Link href={`/vaults/${vault.address}`}>{name}</Link> : name}</b><Badge tone={u.live ? "green" : "amber"} dot>{u.live ? "live" : "idle"}</Badge></div>
                    <div className="small muted">{who}</div>
                    <div className="rwriter-figs">
                      <div><span>USDC locked</span><b className="mono">${usd0(u.usdcReserved)}</b></div>
                      <div><span>{sym} locked</span><b className="mono">{usdK(u.underlyingReserved)}</b></div>
                    </div>
                    <div className="small">{u.account ? <Address value={u.account} href={explorerUrl(cluster, "address", u.account)} /> : <span className="mono muted">linked at deploy</span>}</div>
                  </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : null}
        {tab === "history" ? (
          <div className="scroll-x">
            {data.exercises.length === 0 ? <div className="rempty"><i className="mark" aria-hidden /><div><b>No exercise on {sym} yet on this cluster.</b><div className="small muted">Every exercise, auto-exercise and release lands here with its signature, including the ones that declined.</div></div></div> : (
              <table className="table">
                <thead><tr><th>When</th><th>Event</th><th className="num">Size</th><th>Signature</th></tr></thead>
                <tbody>
                  {data.exercises.map((e, i) => (
                    <tr key={i}>
                      <td className="small mono nowrap">{timeLabel(e.ts)}</td>
                      <td><div className="flex items-center gap-2">{e.kind === "auto_exercise" ? "Auto-exercise" : e.kind === "release" ? "Release" : "Exercise"} <Badge tone={e.ok ? "green" : "amber"} dot>{e.ok ? "settled" : "declined"}</Badge></div><div className="small muted">{e.note}</div></td>
                      <td className="num mono">{e.shares} {sym}</td>
                      <td className="small">{e.signature ? <Address value={e.signature} n={6} href={explorerUrl(cluster, "tx", e.signature)} /> : <span className="mono muted">no signature on this cluster</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ) : null}
        {tab === "vaults" ? <VaultLedger vaults={marketVaults} nowTs={data.nowTs} decimals={market?.decimals ?? 8} sym={sym} /> : null}
      </section>

      <p className="small" style={{ marginTop: 14 }}>{data.source}</p>
    </div>
  );
}

/** The chosen market's terms: one row per term, grouped by expiry, the quote at three sizes and the escrow behind it. */
function Terms({ data, sym, cluster, onOpen }: { data: RosterData; sym: string; cluster: ReturnType<typeof useCluster>; onOpen: (t: Term) => void }) {
  const expiries = [...new Set(data.terms.map((t) => t.expiryTs))].sort((a, b) => a - b);
  if (!data.terms.length) return <div className="rempty"><i className="mark" aria-hidden /><div><b>No live terms on {sym}.</b><div className="small muted">The quoter creates series as capital arrives; a term appears here the moment an ask is resident.</div></div></div>;
  return (
    <div className="scroll-x">
      <table className="table rterms">
        <thead><tr><th>Term</th>{[10, 50, 200].map((n) => <th key={n} className="num">{n} {sym}</th>)}<th className="num">Fillable</th><th className="num">Open</th><th>Escrow</th></tr></thead>
        <tbody>
          {expiries.map((ex) => (
            <RowGroup key={ex} label={`${dayLabel(ex)} · in ${countdown(ex, data.nowTs)}`} rows={data.terms.filter((t) => t.expiryTs === ex).sort((a, b) => (a.side === b.side ? a.strike - b.strike : a.side === "call" ? -1 : 1))} cluster={cluster} onOpen={onOpen} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RowGroup({ label, rows, cluster, onOpen }: { label: string; rows: Term[]; cluster: ReturnType<typeof useCluster>; onOpen: (t: Term) => void }) {
  return (
    <>
      <tr className="rgroup"><td colSpan={7}>{label}</td></tr>
      {rows.map((t) => (
        <tr key={t.id} className="rowlink" onClick={() => onOpen(t)}>
          <td><div className="flex items-center gap-2"><Badge tone={t.side === "call" ? "green" : "blue"}>{productName(t.side)}</Badge><span className="mono">${usdK(t.strike)}</span>{t.halted ? <Badge tone="amber" dot>halted</Badge> : null}</div></td>
          {t.ladder.map((r) => <td key={r.size} className="num mono">{r.ask === null ? <span className="muted">–</span> : <>${usd(r.ask)} <span className="small muted">×{r.underwriters}</span></>}</td>)}
          <td className="num mono">{Math.floor(t.capacity)}</td>
          <td className="num mono">{Math.floor(t.openInterest)}</td>
          <td className="small" onClick={(e) => e.stopPropagation()}>{t.escrow ? <Address value={t.escrow.collateralVault} href={explorerUrl(cluster, "address", t.escrow.collateralVault)} /> : <span className="muted">linked at deploy</span>}</td>
        </tr>
      ))}
    </>
  );
}

/*
 * The vaults' own ledger (Part 3 section 6): every epoch of every vault on this market, its sign included, from the
 * first one. A vault that is short volatility with no hedge will have losing epochs, and a venue that publishes
 * them is the one that keeps its depositors when they come.
 */
function VaultLedger({ vaults, nowTs, decimals, sym }: { vaults: ServicesVault[]; nowTs: number; decimals: number; sym: string }) {
  if (!vaults.length) return <div className="rempty"><i className="mark" aria-hidden /><div><b>No vault on {sym} yet.</b><div className="small muted">A Covered Call vault writes Gaps above the mark; a Cash-Secured Put vault writes Floors below it.</div></div></div>;
  const rows = vaults.flatMap((v) => v.epochs.map((e) => ({ v, e }))).sort((a, b) => b.e.rolledAt - a.e.rolledAt);
  const next = Math.min(...vaults.map((v) => v.nextRollTs));
  return (
    <div>
      <div className="rvaults">
        {vaults.map((v) => {
          const cc = v.kind === "covered_call";
          const losing = v.epochs.filter((e) => Number(e.pnlPerShare1e6) < 0).length;
          return (
            <Link key={v.address} href={`/vaults/${v.address}`} className="rvault">
              <div className="flex items-center justify-between gap-2"><b>{cc ? "Covered Call" : "Cash-Secured Put"}</b><Badge tone={v.halted ? "amber" : "green"} dot>{v.halted ? "halted" : "quoting"}</Badge></div>
              <div className="small muted">{cc ? `writes Gaps above the mark, holds ${sym}` : "writes Floors below the mark, holds USDC"}</div>
              <div className="rwriter-figs">
                <div><span>Premium in</span><b className="mono">${usd(Number(v.epochPremiumIn) / 1e6)}</b></div>
                <div><span>Epochs</span><b className="mono">{v.epochs.length} <span className={`small ${losing ? "down" : "muted"}`}>{losing} losing</span></b></div>
                <div><span>Next roll</span><b className="mono">{countdown(v.nextRollTs, nowTs)}</b></div>
              </div>
            </Link>
          );
        })}
      </div>
      {rows.length === 0 ? <p className="small muted" style={{ padding: "0 20px 16px" }}>No epoch has closed yet; the next rolls at {timeLabel(next)}. Its result, positive or negative, is published here.</p> : (
        <div className="scroll-x">
          <table className="table">
            <thead><tr><th>Vault</th><th className="num">Epoch</th><th>Rolled</th><th className="num">Premium in</th><th className="num">Buybacks</th><th className="num">Assigned</th><th className="num">P&amp;L per share</th></tr></thead>
            <tbody>
              {rows.map(({ v, e }) => {
                const cc = v.kind === "covered_call";
                const unit = cc ? sym : "USDC";
                const pnl = Number(e.pnlPerShare1e6) / 1e6 / (cc ? 10 ** decimals / 1e6 : 1);
                return (
                  <tr key={`${v.address}-${e.epoch}`}>
                    <td>{cc ? "Covered Call" : "Cash-Secured Put"}</td>
                    <td className="num mono">{e.epoch}</td>
                    <td className="nowrap small">{timeLabel(e.rolledAt)}</td>
                    <td className="num mono">${usd(Number(e.premiumIn) / 1e6)}</td>
                    <td className="num mono">${usd(Number(e.buybackOut) / 1e6)}</td>
                    <td className="num mono">{usdK(Number(e.assignedLots6) / 1e6)} lots</td>
                    <td className={`num mono ${pnl < 0 ? "down" : pnl > 0 ? "up" : ""}`}>{pnl === 0 ? "0" : `${pnl > 0 ? "+" : "−"}${Math.abs(pnl).toFixed(6)} ${unit}`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
