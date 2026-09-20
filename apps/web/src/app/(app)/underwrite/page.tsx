"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { MarketLogo } from "@/components/market-list";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { TxStatus } from "@/components/tx-status";
import { Badge, ErrorState, KV, Loading, Tabs } from "@/components/ui";
import { useCluster } from "@/lib/cluster";
import { usd, usd0, usdK, usdSmart, dayLabel, countdown } from "@/lib/format";
import { commitMath, DEFAULT_SIZE, lots6ForShares, sharesOf, type Side, type Term, type WriteIdea } from "@/lib/model";
import { useTransaction } from "@/lib/tx";
import { useRoster } from "@/lib/use-roster";

/*
 * Commit (CLAUDE.md 5, Part 2 section 6): choose market, side and term, enter size and ask, see what is locked, the
 * premium at your ask, the effective acquisition or sale price, and the loss at three adverse prices. One
 * transaction deposits and posts the ask. Your slot on the term shows what sold, what is claimable and what can be
 * withdrawn; after expiry, settle. Disclosure: capital is locked until expiry or exercise; this is paid risk.
 */
export default function UnderwritePage() {
  return (
    <Suspense fallback={<Loading what="terms" />}>
      <Keyed />
    </Suspense>
  );
}

/** A new market or term in the url is a fresh form. */
function Keyed() {
  const params = useSearchParams();
  return <UnderwriteInner key={`${params.get("m") ?? ""}/${params.get("t") ?? ""}`} />;
}

function UnderwriteInner() {
  const params = useSearchParams();
  const router = useRouter();
  const { data, error, reload } = useRoster(params.get("m"));
  const cluster = useCluster();
  const { publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const tx = useTransaction();
  const wanted = params.get("t");
  const [side, setSide] = useState<Side>(wanted?.includes("-call-") ? "call" : "put");
  const [termId, setTermId] = useState<string | null>(wanted);
  const [size, setSize] = useState(() => Math.max(0, Number(params.get("size"))) || 20);
  const [ask, setAsk] = useState<number | null>(null);
  const [explore, setExplore] = useState<string>("all");
  const [showAll, setShowAll] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);

  // Picking a term anywhere on the page lands on the form for it, on this market or another.
  function pick(idea: WriteIdea) {
    if (data && idea.market !== data.underlying.symbol) {
      router.replace(`/underwrite?m=${idea.market}&t=${idea.id}`);
      return;
    }
    setSide(idea.side);
    setTermId(idea.id);
    setAsk(null);
    tx.reset();
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  // Arriving with a term in the url lands on the form; the page remounts on a new `t`, so the state above follows it.
  useEffect(() => {
    if (wanted && data) formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [wanted, data]);

  const ideas = useMemo(() => data?.ideas ?? [], [data]);
  // Trending: the most-bought term on each of three different markets, so the strip reads across the product, not
  // three strikes of one name; filled from the rest only when fewer than three markets have any buying.
  const trending = useMemo(() => {
    const byOi = [...ideas].filter((i) => i.openInterest > 0).sort((a, b) => b.openInterest - a.openInterest);
    const seen = new Set<string>();
    const distinct = byOi.filter((i) => (seen.has(i.market) ? false : (seen.add(i.market), true)));
    return [...distinct, ...byOi.filter((i) => !distinct.includes(i))].slice(0, 3);
  }, [ideas]);
  const featured = useMemo(() => [...ideas].filter((i) => i.onCollateral !== null && i.capacity > 0).sort((a, b) => (b.onCollateral ?? 0) - (a.onCollateral ?? 0)).slice(0, 4), [ideas]);
  const marketsWithIdeas = useMemo(() => [...new Set(ideas.map((i) => i.market))], [ideas]);
  const listed = useMemo(() => ideas.filter((i) => explore === "all" || (explore === "put" && i.side === "put") || (explore === "call" && i.side === "call") || i.market === explore).sort((a, b) => (b.onCollateral ?? 0) - (a.onCollateral ?? 0)), [ideas, explore]);

  if (error) return <ErrorState message={`Could not read the terms: ${error}`} next="Reload the page." />;
  if (!data) return <Loading what="terms" />;
  const terms = data.terms.filter((t) => t.side === side && !t.halted);
  const t = terms.find((x) => x.id === termId) ?? terms[0];
  const u = data.underlying;
  const market = data.markets.find((m) => m.symbol === u.symbol);
  const depthUsd = data.markets.reduce((a, m) => a + m.depthUsdc, 0);
  const marketOf = (symbol: string) => data.markets.find((m) => m.symbol === symbol);
  if (!t || !market) return <ErrorState message="No live terms to underwrite on this market." next="Pick another market from the terms page." />;
  const myAsk = ask ?? Number((t.ask || 0.5).toFixed(4));
  const m = commitMath(side, t.strike, myAsk, size);
  const sym = u.symbol;
  const adverse = side === "put" ? [t.strike * 0.95, t.strike * 0.9, t.strike * 0.8] : [t.strike * 1.05, t.strike * 1.1, t.strike * 1.2];
  const lossAt = (p: number) => (side === "put" ? Math.max(0, t.strike - p) * size : Math.max(0, p - t.strike) * size) - m.premium;
  const me = publicKey?.toBase58();
  const mine = me ? t.slots.find((s) => s.account === me) : undefined;
  const myAsks = mine ? t.asks.filter((a) => a.writerSlot === mine.slot) : [];
  const free = mine ? Math.round((mine.deposited - mine.withdrawn - mine.open - mine.assigned - myAsks.reduce((a, x) => a + sharesOf(x.remainingLots6, u.multiplier), 0)) * 1e4) / 1e4 : 0;
  const busy = tx.state.status === "building" || tx.state.status === "signing" || tx.state.status === "sending";
  const expired = t.expiryTs <= data.nowTs;

  async function run(kind: "quote" | "cancel_ask" | "withdraw_unsold" | "claim_premium" | "settle_writer", p?: Record<string, string | number | null>) {
    if (!t?.series || !u.mint) return;
    const sig = await tx.run({ kind, mint: u.mint, series: t.series, params: p });
    if (sig) reload(true);
  }
  function quote() {
    const lots6 = lots6ForShares(size, u.multiplier);
    const have = lots6ForShares(Math.max(0, free), u.multiplier);
    const deposit = have >= lots6 ? 0n : lots6 - have;
    // Ask per lot in USDC micro: per share x multiplier.
    const askPerLot = BigInt(Math.round(myAsk * u.multiplier * 1e6));
    void run("quote", { depositLots6: deposit.toString(), askLots6: lots6.toString(), askPerLot: askPerLot.toString() });
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Get paid to take the other side</h1>
          <p>Lock the collateral, publish an ask, collect the premium when it fills. Paid risk, disclosed as such: what you collect is yours only if you are not assigned.</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="hstat"><span>Executable depth</span><b className="mono">${usd0(depthUsd)}</b></div>
          <div className="hstat"><span>Terms quoted</span><b className="mono">{ideas.length}</b></div>
        </div>
      </div>

      {trending.length ? (
        <section className="usec">
          <div className="h5">Trending</div>
          <div className="card utrend">
            {trending.map((i, n) => (
              <button key={i.id} className="utrend-item" onClick={() => pick(i)}>
                <span className="rank">{n + 1}</span>
                {marketOf(i.market) ? <MarketLogo m={marketOf(i.market)!} size={36} /> : null}
                <span style={{ minWidth: 0 }}>
                  <span className="name"><b>{i.market}</b> <span className="muted">${usdK(i.strike)} {i.side === "put" ? "Floor" : "Gap"}</span></span>
                  <span className="sub"><span className="up">{usdK(i.openInterest)} bought</span> · {dayLabel(i.expiryTs)} · ${usd(i.ask)}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {featured.length ? (
        <section className="usec">
          <div className="h5">Best paid right now</div>
          <div className="ufeat">
            {featured.map((i) => (
              <button key={i.id} className="card ufeat-card" onClick={() => pick(i)} data-testid="featured-term">
                <div className="flex items-center justify-between">
                  {marketOf(i.market) ? <MarketLogo m={marketOf(i.market)!} size={36} /> : <span />}
                  <Badge tone={i.side === "put" ? "blue" : "green"}>{i.side === "put" ? "Floor" : "Gap"}</Badge>
                </div>
                <div className="name" style={{ marginTop: 18 }}><b>{i.market}</b> <span className="muted">${usdK(i.strike)}</span></div>
                <div className="small muted">{dayLabel(i.expiryTs)} · {i.side === "put" ? "get paid to buy lower" : "get paid to sell higher"}</div>
                <div className="rows">
                  <div><span>Premium per share</span><b className="mono">${usd(i.ask)}</b></div>
                  <div><span>On collateral, to expiry</span><b className="mono">{i.onCollateral !== null ? `${(i.onCollateral * 100).toFixed(2)}%` : "n/a"}</b></div>
                  <div><span>Fillable</span><b className="mono">{usdK(i.capacity)} {i.market}</b></div>
                </div>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <section className="usec">
        <div className="h5">Explore terms</div>
        <div className="uexplore">
          <button className={`utile ${explore === "all" ? "on" : ""}`} onClick={() => { setExplore("all"); setShowAll(false); }}><span className="t">All terms</span><span className="s">{ideas.length} quoted</span></button>
          <button className={`utile ${explore === "put" ? "on" : ""}`} onClick={() => { setExplore("put"); setShowAll(false); }}><span className="t">Floors</span><span className="s">get paid to buy lower</span></button>
          <button className={`utile ${explore === "call" ? "on" : ""}`} onClick={() => { setExplore("call"); setShowAll(false); }}><span className="t">Gaps</span><span className="s">get paid to sell higher</span></button>
          {marketsWithIdeas.map((mk) => <button key={mk} className={`utile ${explore === mk ? "on" : ""}`} onClick={() => { setExplore(mk); setShowAll(false); }}><span className="t flex items-center gap-2">{marketOf(mk) ? <MarketLogo m={marketOf(mk)!} size={18} /> : null}{mk}</span><span className="s">{ideas.filter((i) => i.market === mk).length} terms</span></button>)}
        </div>
        <div className="card mlist" style={{ marginTop: 12 }}>
          <table className="table mtable ulist">
            <thead><tr><th>Term</th><th>Expiry</th><th className="num">Premium per share</th><th className="num">On collateral</th><th className="num hide-sm">Bought</th><th className="num hide-sm">Fillable</th><th className="num hide-sm">Underwriters</th></tr></thead>
            <tbody>
              {listed.length === 0 ? <tr><td colSpan={7} className="muted" style={{ padding: 20 }}>Nothing quoted here right now.</td></tr> : null}
              {(showAll ? listed : listed.slice(0, 12)).map((i) => (
                <tr key={i.id} className={`rowlink ${i.id === t.id ? "on" : ""}`} onClick={() => pick(i)} data-testid="idea-row">
                  <td><div className="flex items-center gap-3">{marketOf(i.market) ? <MarketLogo m={marketOf(i.market)!} size={26} /> : null}<span><b style={{ fontWeight: 500 }}>{i.market}</b> <span className="muted">${usdK(i.strike)} {i.side === "put" ? "Floor" : "Gap"}</span></span></div></td>
                  <td className="nowrap">{dayLabel(i.expiryTs)}</td>
                  <td className="num mono">${usd(i.ask)}</td>
                  <td className="num mono">{i.onCollateral !== null ? `${(i.onCollateral * 100).toFixed(2)}%` : "n/a"}</td>
                  <td className="num mono hide-sm">{usdK(i.openInterest)}</td>
                  <td className="num mono hide-sm">{usdK(i.capacity)}</td>
                  <td className="num mono hide-sm">{i.underwriters}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {listed.length > 12 ? <button className="btn ghost" style={{ width: "100%", borderTop: "1px solid var(--line)", borderRadius: 0 }} onClick={() => setShowAll((x) => !x)}>{showAll ? "Show fewer" : `Show all ${listed.length} terms`}</button> : null}
        </div>
        <p className="small muted" style={{ marginTop: 8 }}>On collateral is the premium over what you lock per share, for this term&apos;s life, never annualised. A result you keep only if you are not assigned.</p>
      </section>

      <div ref={formRef} className="page-head" style={{ marginTop: 34, scrollMarginTop: 80 }}>
        <div>
          <h2 className="h4" style={{ margin: 0 }}>Write on {sym}</h2>
          <p className="body-sm" style={{ margin: "4px 0 0" }}>{market.name} · <Link href={`/markets/${sym}`}>market page</Link>{marketsWithIdeas.length > 1 ? <> · or pick another market above</> : null}</p>
        </div>
      </div>
      <div className="grid-2 split-right">
        <div className="card pad">
          <Tabs value={side} onChange={(v) => { setSide(v as Side); setTermId(null); setAsk(null); tx.reset(); }} items={[{ id: "put", label: "Floors" }, { id: "call", label: "Gaps" }]} />
          <label className="lbl" style={{ marginTop: 16 }}>Term</label>
          <select className="field" value={t.id} onChange={(e) => { setTermId(e.target.value); setAsk(null); tx.reset(); }} aria-label="Term" data-testid="term">
            {terms.map((x) => <option key={x.id} value={x.id}>${usdK(x.strike)} through {dayLabel(x.expiryTs)} · {x.ask ? `best ask $${usd(x.ask)}` : "no ask yet"}</option>)}
          </select>
          <div className="grid-2" style={{ marginTop: 12 }}>
            <div>
              <label className="lbl">Size in {sym}</label>
              <input className="field mono" type="number" min={1} step={1} value={size} onChange={(e) => setSize(Math.max(1, Math.floor(Number(e.target.value) || DEFAULT_SIZE)))} aria-label="Size" data-testid="write-size" />
            </div>
            <div>
              <label className="lbl">Your ask per share</label>
              <input className="field mono" type="number" min={0.01} step={0.05} value={myAsk} onChange={(e) => setAsk(Math.max(0.01, Number(e.target.value) || 0.01))} aria-label="Ask per share" data-testid="write-ask" />
            </div>
          </div>
          <div className="divider" style={{ margin: "16px 0" }} />
          <KV items={[
            { k: side === "put" ? "USDC to lock" : `${sym} to lock`, v: <span className="mono ink" style={{ fontWeight: 500 }}>{side === "put" ? `$${usd0(m.locked)}` : `${m.locked} ${sym}`}</span> },
            { k: "Premium you receive", v: <span className="mono up">${usdSmart(m.premium)}</span> },
            { k: side === "put" ? "Effective buy price if assigned" : "Effective sale price if assigned", v: <span className="mono">${usd(m.effective)}</span> },
            { k: "Locked until", v: `${dayLabel(t.expiryTs)} or exercise` },
            ...(mine && free > 0 ? [{ k: "Already free in your slot", v: <span className="mono">{free} {sym}</span> }] : [])
          ]} />
          <div className="divider" style={{ margin: "16px 0" }} />
          {!publicKey ? (
            <button className="btn primary wide" onClick={() => setVisible(true)}>Connect wallet to quote</button>
          ) : (
            <button className="btn primary wide" disabled={!cluster.programDeployed || busy || expired || !t.series} onClick={quote} data-testid="write">Lock {side === "put" ? `$${usd0(Math.max(0, m.locked - (side === "put" ? free * t.strike : 0)))}` : `${Math.max(0, m.locked - free)} ${sym}`} and quote</button>
          )}
          {publicKey && !cluster.programDeployed ? <div className="msg red" style={{ marginTop: 10 }} role="alert">Program not deployed on {cluster.label}; nothing to sign yet.</div> : null}
          <TxStatus state={tx.state} onRetry={() => { tx.reset(); reload(true); }} doneHref={`/roster?m=${sym}`} doneLabel="See it on the roster" />
          <p className="note" style={{ marginTop: 12 }}>Capital is locked until expiry or exercise. This is paid risk, not yield: if the price moves through the strike you are assigned at it. Assignment is pooled: every writer on the term is assigned in proportion to what they sold, whoever bought the contract that was exercised.</p>
        </div>
        <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
          <div className="card">
            <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--line)" }}>
              <div className="h6">Loss scenarios</div>
              <div className="small" style={{ marginTop: 4 }}>What assignment costs at three adverse prices, net of the premium you collected.</div>
            </div>
            <div className="scroll-x">
              <table className="table">
                <thead><tr><th>{sym} at expiry</th><th className="num">Assignment</th><th className="num">Premium kept</th><th className="num">Net</th></tr></thead>
                <tbody>
                  {adverse.map((p) => (
                    <tr key={p}>
                      <td><span className="mono">${usd(p)}</span> <span className="small muted">({side === "put" ? "−" : "+"}{Math.abs(((p - t.strike) / t.strike) * 100).toFixed(0)}% from strike)</span></td>
                      <td className="num">{side === "put" ? `buy ${size} at $${usdK(t.strike)}` : `sell ${size} at $${usdK(t.strike)}`}</td>
                      <td className="num up">+${usdSmart(m.premium)}</td>
                      <td className="num down">−${usdSmart(lossAt(p))}</td>
                    </tr>
                  ))}
                  <tr><td>Not assigned</td><td className="num muted">collateral released at expiry</td><td className="num up">+${usdSmart(m.premium)}</td><td className="num up">+${usdSmart(m.premium)}</td></tr>
                </tbody>
              </table>
            </div>
          </div>
          {mine ? <MySlot t={t} sym={sym} multiplier={u.multiplier} mine={mine} myAsks={myAsks} free={free} expired={expired} nowTs={data.nowTs} busy={busy} onAction={run} /> : (
            <div className="card pad">
              <div className="h6">After you quote</div>
              <p className="body-sm" style={{ margin: "6px 0 0" }}>Your ask goes live on the roster next to every other underwriter on the term. Buyers match the cheapest asks first, so a fill can be partial. Premium accrues to your slot with each fill and is yours to claim any time. At expiry, what was not assigned is released and what was is settled at the strike, in one transaction anyone can send.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MySlot({ t, sym, multiplier, mine, myAsks, free, expired, nowTs, busy, onAction }: { t: Term; sym: string; multiplier: number; mine: Term["slots"][number]; myAsks: Term["asks"]; free: number; expired: boolean; nowTs: number; busy: boolean; onAction: (kind: "cancel_ask" | "withdraw_unsold" | "claim_premium" | "settle_writer", p?: Record<string, string | number | null>) => Promise<void> }) {
  return (
    <div className="card" data-testid="my-slot">
      <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--line)" }}>
        <div className="h6">Your slot on this term</div>
        <div className="small" style={{ marginTop: 4 }}>{mine.settled ? "Settled." : expired ? "Expired: settle to release what was not assigned and receive the strike for what was." : `Live until ${dayLabel(t.expiryTs)}, in ${countdown(t.expiryTs, nowTs)}.`}</div>
      </div>
      <div style={{ padding: "12px 20px" }}>
        <KV items={[
          { k: "Deposited", v: <span className="mono">{mine.deposited} {sym} covered{t.side === "put" ? ` ($${usd0(mine.deposited * t.strike)} USDC locked)` : ""}</span> },
          { k: "Sold, still open", v: <span className="mono">{mine.open} {sym}</span> },
          { k: "Assigned", v: <span className="mono">{mine.assigned} {sym}</span> },
          { k: "Quoted, unsold", v: <span className="mono">{Math.round(myAsks.reduce((a, x) => a + sharesOf(x.remainingLots6, multiplier), 0) * 1e4) / 1e4} {sym} in {myAsks.length} ask{myAsks.length === 1 ? "" : "s"}</span> },
          { k: "Free to withdraw", v: <span className="mono">{Math.max(0, free)} {sym}</span> },
          { k: "Premium claimable", v: <span className="mono up">${usd(mine.premiumClaimable)}</span> }
        ]} />
        <div className="flex items-center gap-2 flex-wrap" style={{ marginTop: 12 }}>
          {myAsks.map((a) => <button key={a.seq} className="btn secondary sm" disabled={busy || mine.settled} onClick={() => onAction("cancel_ask", { seq: a.seq })}>Cancel ask ${usd(Number(a.askPerLot) / 1e6 / multiplier)} × {sharesOf(a.remainingLots6, multiplier)}</button>)}
          <button className="btn secondary sm" disabled={busy || mine.premiumClaimable <= 0} onClick={() => onAction("claim_premium")} data-testid="claim">Claim premium</button>
          <button className="btn secondary sm" disabled={busy || free <= 0 || mine.settled} onClick={() => onAction("withdraw_unsold", { lots6: lots6ForShares(free, multiplier).toString() })}>Withdraw {Math.max(0, free)} unsold</button>
          {expired && !mine.settled ? <button className="btn primary sm" disabled={busy} onClick={() => onAction("settle_writer")} data-testid="settle">Settle</button> : null}
        </div>
      </div>
    </div>
  );
}
