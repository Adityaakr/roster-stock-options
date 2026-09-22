"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useConnect } from "@/lib/connect";
import { PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { LineChart } from "@/components/charts";
import { MarketLogo } from "@/components/market-list";
import { TxStatus } from "@/components/tx-status";
import { Address, Badge, ErrorState, Loading, Tabs } from "@/components/ui";
import { useCluster, explorerUrl } from "@/lib/cluster";
import { usd, usd0, usdK, countdown, timeLabel, dayLabel } from "@/lib/format";
import type { ServicesEvent, ServicesVaultPosition } from "@/lib/services";
import { useTransaction } from "@/lib/tx";
import { useRoster } from "@/lib/use-roster";
import { pnlLabel, shortWhen, useVaults, vaultView, type VaultView } from "@/lib/vaults";

/*
 * One vault (Part 3): the title, where it lives, the four figures a depositor reads first, then tabs for how it is
 * configured, what it has written, how every epoch went, what can go wrong, and what has happened. The deposit panel
 * stays at the right: an amount, what it turns into, when it enters, and the three adverse prices in real numbers.
 */
type Tab = "overview" | "positions" | "performance" | "risk" | "activity";

export default function VaultPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = use(params);
  const { vaults, error: verr, reload } = useVaults();
  const v = vaults?.find((x) => x.address === address) ?? null;
  const { data, error } = useRoster(v?.symbol ?? null);
  const [tab, setTab] = useState<Tab>("overview");
  const cluster = useCluster();

  if (error) return <ErrorState message={`Could not read the market: ${error}`} next="Reload the page." />;
  if (verr) return <ErrorState message={`Could not read the vault: ${verr}`} next="Reload the page." />;
  if (vaults === null || !data) return <Loading what="the vault" />;
  if (!v) return <ErrorState message="No vault at this address." next={<Link href="/vaults">Back to the vaults.</Link>} />;
  const market = data.markets.find((m) => m.symbol === v.symbol);
  const x = vaultView(v, market);
  const nowTs = data.nowTs;
  const myTerms = data.terms.filter((t) => t.slots.some((s) => s.account === v.address && (s.deposited > s.withdrawn || s.sold > 0)));

  return (
    <div className="vdetail">
      <div className="vdetail-main">
        <div className="small" style={{ marginBottom: 14 }}><Link className="muted" href="/vaults">Vaults</Link> <span className="muted">/</span> {v.symbol} {x.kindLabel}</div>
        <div className="flex items-center gap-4">
          {market ? <MarketLogo m={market} size={44} /> : null}
          <h1 className="vtitle"><span>{v.symbol}</span> <span className="muted">{x.kindLabel}</span></h1>
        </div>
        <div className="vmeta">
          <Address value={v.address} href={explorerUrl(cluster, "address", v.address)} />
          <Badge tone={v.halted ? "amber" : "green"} dot>{v.halted ? "halted" : "quoting"}</Badge>
          <Link className="chip" href={`/markets/${v.symbol}`}>{v.symbol} market</Link>
          <span className="chip">Deposit {x.unit}</span>
          <span className="chip">Manager: Roster treasury</span>
          <span className="chip">Epoch {v.epoch}</span>
        </div>
        <p className="body-sm" style={{ margin: "18px 0 0", maxWidth: 720 }}>
          {x.cc
            ? `Deposit ${v.symbol}. The vault sells calls above the mark on the nearest expiry and keeps the premium for its depositors; if the price runs through a strike, the tokens are sold at it. Nothing is hedged, because nothing can be.`
            : `Deposit USDC. The vault sells puts below the mark on the nearest expiry and keeps the premium for its depositors; if the price falls through a strike, it buys ${v.symbol} at it. Nothing is hedged, because nothing can be.`}
        </p>

        <div className="vfigs">
          <Fig k="Total deposits" v={x.depositsUsd !== null ? `$${usd0(x.depositsUsd)}` : "no mark"} s={`${usdK(x.collateral + x.otherInCollateral)} ${x.unit}, other asset at the mark`} />
          <Fig k="Free to write" v={usdK(x.free)} unit={x.unit} s={`${usdK(x.other)} ${x.otherUnit} held alongside`} />
          <Fig k="Exposure" v={usdK(x.locked)} unit={x.unit} s={`locked in ${myTerms.length} live series · ${x.collateral > 0 ? Math.round((x.locked / x.collateral) * 100) : 0}% of collateral`} />
          <Fig k="Last epoch" v={x.lastPnlPct !== null ? `${x.lastPnlPct >= 0 ? "+" : "−"}${(Math.abs(x.lastPnlPct) * 100).toFixed(2)}%` : pnlLabel(x.lastPnlPerShare, x.unit)} s={x.lastEpoch ? `epoch ${x.lastEpoch.epoch}, ${shortWhen(x.lastEpoch.rolledAt)} UTC · a result, not a rate` : "no epoch has rolled yet"} tone={x.lastPnlPerShare === null ? undefined : x.lastPnlPerShare < 0 ? "down" : x.lastPnlPerShare > 0 ? "up" : undefined} />
        </div>

        <div style={{ margin: "26px 0 18px" }}>
          <Tabs value={tab} onChange={setTab} items={[{ id: "overview", label: "Overview" }, { id: "positions", label: "Positions" }, { id: "performance", label: "Performance" }, { id: "risk", label: "Risk" }, { id: "activity", label: "Activity" }]} />
        </div>

        {tab === "overview" ? <Overview x={x} nowTs={nowTs} /> : null}
        {tab === "positions" ? <Positions x={x} terms={myTerms} nowTs={nowTs} /> : null}
        {tab === "performance" ? <Performance x={x} /> : null}
        {tab === "risk" ? <Risk x={x} /> : null}
        {tab === "activity" ? <Activity x={x} /> : null}
      </div>

      <aside className="vdetail-side">
        <DepositPanel x={x} market={market} nowTs={nowTs} onChanged={reload} />
      </aside>
    </div>
  );
}

function Fig({ k, v, unit, s, tone }: { k: string; v: string; unit?: string; s: string; tone?: "up" | "down" }) {
  return (
    <div className="vfig">
      <div className="k">{k}</div>
      <div className={`v ${tone ?? ""}`}>{v}{unit ? <span className="unit">{unit}</span> : null}</div>
      <div className="s">{s}</div>
    </div>
  );
}

function Rows({ rows }: { rows: { k: string; v: React.ReactNode }[] }) {
  return (
    <div className="vrows">
      {rows.map((r) => <div key={r.k}><span>{r.k}</span><b>{r.v}</b></div>)}
    </div>
  );
}

function Overview({ x, nowTs }: { x: VaultView; nowTs: number }) {
  const cluster = useCluster();
  const v = x.v;
  const points = v.epochs.map((e) => [e.rolledAt, Number(e.navCollateralRaw) / (x.cc ? x.rawPerToken : 1e6) / Math.max(1e-9, Number(e.totalSharesAfter) / 1e6)] as [number, number]);
  return (
    <div style={{ display: "grid", gap: 18 }}>
      <section>
        <div className="h6" style={{ marginBottom: 8 }}>How it is set up</div>
        <Rows rows={[
          { k: "Writes", v: `${x.cc ? "Calls" : "Puts"} on ${v.symbol}, on series that expire before the next roll` },
          { k: "Rolls", v: `every ${Math.round(v.rollIntervalSecs / 3600)} hours · next ${timeLabel(v.nextRollTs)} · in ${countdown(v.nextRollTs, nowTs)}` },
          { k: "Cap per series", v: `${usdK(x.capLots)} lots, then the vault stops asking there` },
          { k: "Bid spread", v: `${(v.spreadBps / 100).toFixed(2)}% below theoretical, widened by the session, never below intrinsic` },
          { k: "Mark band at the roll", v: `±${(v.markBandBps / 100).toFixed(0)}% of the previous roll's mark` },
          { k: "Shares", v: `${usdK(x.totalShares)} outstanding · ${x.navPerShare.toFixed(4)} ${x.unit} each` },
          { k: "Queued", v: `${usdK(x.pendingDeposit)} ${x.unit} entering at the roll · ${usdK(x.pendingWithdrawShares)} shares leaving at it` },
          { k: "Vault account", v: <Address value={v.address} href={explorerUrl(cluster, "address", v.address)} /> },
          { k: "Share mint", v: <Address value={v.shareMint} href={explorerUrl(cluster, "address", v.shareMint)} /> },
          { k: "Collateral account", v: <Address value={v.collateralAta} href={explorerUrl(cluster, "address", v.collateralAta)} /> },
        ]} />
      </section>
      <section className="card pad">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="small muted">Value per share</div>
            <div className="h3 mono" style={{ margin: 0 }}>{x.navPerShare.toFixed(4)} <span className="small muted">{x.unit}</span></div>
          </div>
          <div className="small muted">at each roll, in {x.unit}; the other asset counted at the mark</div>
        </div>
        <div style={{ marginTop: 12 }}>
          <LineChart series={[{ label: `${x.unit} per share`, points }]} height={220} format={(n) => n.toFixed(4)} empty="The line begins at the second roll." />
        </div>
      </section>
    </div>
  );
}

function Positions({ x, terms, nowTs }: { x: VaultView; terms: ReturnType<typeof useRoster>["data"] extends infer D ? D extends { terms: infer T } ? T : never : never; nowTs: number }) {
  const v = x.v;
  if (!terms.length) return <p className="small muted">The vault has nothing in a live series right now. It writes at the first tick after a roll, on series that expire before the next one.</p>;
  return (
    <div className="vtable-wrap">
      <table className="table vtable">
        <thead><tr><th>Series</th><th>Expiry</th><th className="num">Deposited</th><th className="num">Sold</th><th className="num">Open</th><th className="num">Assigned</th><th className="num">Premium</th><th className="num">Ask</th></tr></thead>
        <tbody>
          {terms.map((t) => {
            const s = t.slots.find((sl) => sl.account === v.address)!;
            const asks = t.asks.filter((a) => a.writerSlot === s.slot);
            return (
              <tr key={t.id}>
                <td><Link href={`/trade/${t.id}`}>{t.side === "call" ? "Upside" : "Floor"} ${usdK(t.strike)}</Link></td>
                <td className="nowrap">{dayLabel(t.expiryTs)} · {t.expiryTs > nowTs ? countdown(t.expiryTs, nowTs) : "expired"}</td>
                <td className="num mono">{usdK(s.deposited - s.withdrawn)}</td>
                <td className="num mono">{usdK(s.sold)}</td>
                <td className="num mono">{usdK(s.open)}</td>
                <td className="num mono">{usdK(s.assigned)}</td>
                <td className="num mono">${usd(s.premiumClaimable)}</td>
                <td className="num mono">{asks.length ? `${asks.length} at $${usd(Number(asks[0]!.askPerLot) / 1e6)}` : "none"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Performance({ x }: { x: VaultView }) {
  const v = x.v;
  const pnlPoints = v.epochs.map((e) => [e.rolledAt, Number(e.pnlPerShare1e6) / 1e6 / (x.cc ? x.rawPerToken / 1e6 : 1)] as [number, number]);
  const wins = v.epochs.filter((e) => Number(e.pnlPerShare1e6) > 0).length;
  const losses = v.epochs.filter((e) => Number(e.pnlPerShare1e6) < 0).length;
  return (
    <div style={{ display: "grid", gap: 18 }}>
      <section className="card pad">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="small muted">P&amp;L per share, each epoch</div>
            <div className="h3 mono" style={{ margin: 0 }}>{pnlLabel(x.lastPnlPerShare, x.unit)}</div>
          </div>
          <div className="small muted">{v.epochs.length} epochs · {wins} up · {losses} down · this one so far: ${usd(x.premiumIn)} premium, ${usd(x.buybackOut)} on buybacks, {usdK(x.assignedLots)} lots assigned</div>
        </div>
        <div style={{ marginTop: 12 }}>
          <LineChart series={[{ label: "P&L per share", points: pnlPoints }]} height={200} format={(n) => n.toFixed(4)} empty="No epoch has rolled yet." />
        </div>
      </section>
      <section>
        <div className="h6" style={{ marginBottom: 8 }}>Every epoch, published</div>
        {v.epochs.length === 0 ? <p className="small muted">No epoch has rolled yet.</p> : (
          <div className="vtable-wrap">
            <table className="table vtable">
              <thead><tr><th>Epoch</th><th>Rolled</th><th className="num">Premium in</th><th className="num">Buybacks</th><th className="num">Assigned</th><th className="num">P&amp;L per share</th><th className="num">Mark</th><th className="num">Shares after</th></tr></thead>
              <tbody>
                {[...v.epochs].reverse().map((e) => {
                  const pnl = Number(e.pnlPerShare1e6) / 1e6 / (x.cc ? x.rawPerToken / 1e6 : 1);
                  return (
                    <tr key={e.epoch} data-testid="vault-epoch">
                      <td className="mono">{e.epoch}</td>
                      <td className="nowrap">{shortWhen(e.rolledAt)}</td>
                      <td className="num mono">${usd(Number(e.premiumIn) / 1e6)}</td>
                      <td className="num mono">${usd(Number(e.buybackOut) / 1e6)}</td>
                      <td className="num mono">{usdK(Number(e.assignedLots6) / 1e6)}</td>
                      <td className={`num mono ${pnl < 0 ? "down" : pnl > 0 ? "up" : ""}`}>{pnlLabel(pnl, x.unit)}</td>
                      <td className="num mono">${usd(Number(e.markUsdcPerLot) / 1e6)}</td>
                      <td className="num mono">{usdK(Number(e.totalSharesAfter) / 1e6)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Risk({ x }: { x: VaultView }) {
  const v = x.v;
  return (
    <div style={{ display: "grid", gap: 14, maxWidth: 760 }}>
      <p className="body-sm" style={{ margin: 0 }}>This vault is short volatility with no hedge, because there is no single-name stock perp on Solana to hedge on. It will have losing epochs. Every one is published on the Performance tab from the first, and nothing here is yield.</p>
      <Rows rows={[
        { k: "What you can lose", v: x.cc ? `The upside above each strike the vault sold. If ${v.symbol} gaps through a strike, those tokens are sold at it and the vault holds USDC worth less than the tokens were.` : `The difference between each strike and the market. If ${v.symbol} falls through a strike, the vault buys at it and holds tokens worth less than the USDC was.` },
        { k: "What you cannot lose", v: "More than what you deposited. Every contract is fully collateralized by the vault's own deposit; there is no borrowing, no funding, no liquidation." },
        { k: "Queues", v: "Deposits enter at the next roll, withdrawals leave at it. A withdrawal is paid pro rata in both assets the vault holds at that roll." },
        { k: "The mark at the roll", v: `The manager posts the mark that values the other asset for minting new shares. It must sit within ±${(v.markBandBps / 100).toFixed(0)}% of the previous roll's, is recorded on chain, and never decides what a withdrawer is paid.` },
        { k: "Breakers", v: `The vault stops quoting when the price is stale, the basis blows out, the mint is paused or frozen, or its manager halts it. ${v.halted ? "It is halted right now." : "It is quoting right now."} A halted vault still settles, rolls and pays withdrawals.` },
        { k: "Not protected against", v: "Chain halts, a freeze or pause on the underlying mint, and a transfer restriction from the issuer. The program cannot route around those." },
      ]} />
    </div>
  );
}

const EVENT_LABEL: Record<string, string> = { VaultCreated: "Vault created", VaultDeposited: "Deposit queued", VaultWithdrawRequested: "Withdrawal queued", VaultRolled: "Epoch rolled", VaultClaimed: "Claimed", VaultQuoted: "Ask posted", VaultSettled: "Series settled", BidPosted: "Bid posted", BoughtBack: "Bought back", VaultHaltToggled: "Halt toggled", AskPosted: "Ask posted", AskCancelled: "Ask cancelled", Fill: "Filled", PremiumClaimed: "Premium claimed", WriterSettled: "Settled" };

function Activity({ x }: { x: VaultView }) {
  const cluster = useCluster();
  const [events, setEvents] = useState<ServicesEvent[] | null>(null);
  useEffect(() => {
    fetch(`/api/events?account=${x.v.address}`, { cache: "no-store" }).then((r) => (r.ok ? (r.json() as Promise<ServicesEvent[]>) : [])).then((j) => setEvents(Array.isArray(j) ? j : [])).catch(() => setEvents([]));
  }, [x.v.address]);
  if (events === null) return <Loading what="the vault's activity" />;
  if (!events.length) return <p className="small muted">Nothing recorded for this vault yet.</p>;
  return (
    <div className="vtable-wrap">
      <table className="table vtable">
        <thead><tr><th>When</th><th>Event</th><th>Detail</th><th className="num">Signature</th></tr></thead>
        <tbody>
          {events.map((e) => {
            const d = JSON.parse(e.data_json) as Record<string, string | number>;
            const detail = e.name === "VaultRolled" ? `epoch ${d.epoch} at mark $${usd(Number(d.markUsdcPerLot) / 1e6)} · P&L ${Number(d.pnlPerShare1e6) / 1e6} per share` : e.name === "BoughtBack" ? `${Number(d.lots6) / 1e6} lots for $${usd(Number(d.premium) / 1e6)}` : e.name === "VaultDeposited" ? `${Number(d.raw) / (x.cc ? x.rawPerToken : 1e6)} ${x.unit}` : e.name === "VaultQuoted" || e.name === "AskPosted" ? `${Number(d.askLots6 ?? d.lots6) / 1e6} lots at $${usd(Number(d.askPerLot) / 1e6)}` : e.name === "BidPosted" ? `up to ${Number(d.maxLots6) / 1e6} lots at $${usd(Number(d.bidPerLot) / 1e6)}` : e.name === "VaultSettled" ? `${Number(d.assignedLots6) / 1e6} lots assigned` : "";
            return (
              <tr key={`${e.signature}-${e.ix_index}`}>
                <td className="nowrap">{shortWhen(e.block_time)}</td>
                <td>{EVENT_LABEL[e.name] ?? e.name}</td>
                <td className="small">{detail}</td>
                <td className="num"><Address value={e.signature} href={explorerUrl(cluster, "tx", e.signature)} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DepositPanel({ x, market, nowTs, onChanged }: { x: VaultView; market: ReturnType<typeof useRoster>["data"] extends infer D ? D extends { markets: (infer M)[] } ? M | undefined : never : never; nowTs: number; onChanged: () => void }) {
  const cluster = useCluster();
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const connect = useConnect();
  const tx = useTransaction();
  const v = x.v;
  const [amount, setAmount] = useState<number>(0);
  const [balance, setBalance] = useState<number | null>(null);
  const [pos, setPos] = useState<ServicesVaultPosition | null>(null);
  const [withdrawShares, setWithdrawShares] = useState(0);
  const me = publicKey?.toBase58() ?? null;

  const loadPos = useCallback(() => {
    const url = me ? `/api/vaults/${v.address}/position/${me}` : null;
    (url ? fetch(url, { cache: "no-store" }).then((r) => (r.ok ? (r.json() as Promise<ServicesVaultPosition>) : null)) : Promise.resolve(null)).then((j) => setPos(j)).catch(() => setPos(null));
  }, [me, v.address]);
  useEffect(() => { loadPos(); }, [loadPos]);

  useEffect(() => {
    if (!publicKey) return;
    const mint = new PublicKey(v.collateralMint);
    const program = x.cc ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
    const ata = getAssociatedTokenAddressSync(mint, publicKey, false, program);
    connection.getTokenAccountBalance(ata, "confirmed").then((b) => setBalance(Number(b.value.amount) / (x.cc ? x.rawPerToken : 1e6))).catch(() => setBalance(0));
  }, [publicKey, connection, v.collateralMint, x.cc, x.rawPerToken]);

  const busy = tx.state.status === "building" || tx.state.status === "signing" || tx.state.status === "sending";
  const myShares = pos ? Number(pos.shares) / 1e6 : 0;
  const queuedDeposit = pos ? Number(pos.queuedDepositRaw) / (x.cc ? x.rawPerToken : 1e6) : 0;
  const queuedWithdraw = pos ? Number(pos.queuedWithdrawShares) / 1e6 : 0;
  const claimable = pos && ((Number(pos.queuedDepositRaw) > 0 && pos.queuedDepositEpoch !== null && pos.queuedDepositEpoch < v.epoch) || (Number(pos.queuedWithdrawShares) > 0 && pos.queuedWithdrawEpoch !== null && pos.queuedWithdrawEpoch < v.epoch));
  const claimEpoch = pos ? (Number(pos.queuedDepositRaw) > 0 ? pos.queuedDepositEpoch : pos.queuedWithdrawEpoch) : null;
  const unitUsd = x.mark ? (x.cc ? x.mark * (market?.multiplier ?? 1) : 1) : null;
  const sharesFor = amount > 0 ? amount / x.navPerShare : 0;
  const strikeGuess = x.mark ? (x.cc ? x.mark * 1.025 : x.mark * 0.975) : null;
  const scenarios = x.mark && strikeGuess ? (x.cc ? [x.mark * 1.05, x.mark * 1.1, x.mark * 1.2] : [x.mark * 0.95, x.mark * 0.9, x.mark * 0.8]).map((p) => ({ p, loss: x.cc ? Math.max(0, p - strikeGuess) * amount : Math.max(0, strikeGuess - p) * (amount / strikeGuess) })) : [];

  async function run(kind: "vault_deposit" | "vault_request_withdraw" | "vault_claim", params: Record<string, string | number | null>) {
    if (!market?.mint) return;
    const sig = await tx.run({ kind, mint: market.mint, series: "", params: { kind: v.kind, ...params } });
    if (sig) { onChanged(); loadPos(); }
  }

  return (
    <div className="vpanel-stack">
      <div className="vdep">
        <div className="flex items-center justify-between">
          <div className="small">Deposit {x.unit}</div>
          {market ? <MarketLogo m={market} size={20} /> : null}
        </div>
        <input className="vdep-amount mono" type="number" min={0} step={0.01} value={amount || ""} placeholder="0.00" onChange={(e) => setAmount(Math.max(0, Number(e.target.value) || 0))} data-testid="vault-amount" aria-label={`Amount of ${x.unit}`} />
        <div className="flex items-center justify-between small muted">
          <span className="mono">{unitUsd !== null ? `$${usd(amount * unitUsd)}` : ""}</span>
          <span className="flex items-center gap-2">
            <span className="mono">{balance !== null ? `${usdK(balance)} ${x.unit}` : publicKey ? "…" : ""}</span>
            {balance ? <button className="btn secondary sm" onClick={() => setAmount(balance)}>Max</button> : null}
          </span>
        </div>
      </div>

      <div className="vsummary">
        <Rows rows={[
          { k: "Enters at", v: <span className="mono">{shortWhen(v.nextRollTs)} UTC</span> },
          { k: "That is in", v: <span className="mono">{countdown(v.nextRollTs, nowTs)}</span> },
          { k: "You would receive", v: <span className="mono">{amount > 0 ? `${usdK(sharesFor)} shares` : "0 shares"}</span> },
          { k: "Value per share", v: <span className="mono">{x.navPerShare.toFixed(4)} {x.unit}</span> },
          { k: "Premium this epoch so far", v: <span className="mono">${usd(x.premiumIn)} USDC</span> },
        ]} />
        {scenarios.length && amount > 0 ? (
          <div className="vscen" style={{ marginTop: 10 }}>
            <div className="small muted">If assigned, at three adverse prices, before the premium:</div>
            {scenarios.map((sc) => <div key={sc.p} className="vscen-row"><span className="mono">{v.symbol} at ${usd(sc.p)}</span><span className="mono">{x.cc ? `forgo about $${usd(sc.loss)}` : `about $${usd(sc.loss)} above market`}</span></div>)}
          </div>
        ) : null}
      </div>

      {!publicKey ? (
        <button className="btn primary vcta" onClick={() => connect()}>Connect wallet</button>
      ) : (
        <button className="btn primary vcta" disabled={busy || amount <= 0 || !cluster.programDeployed || v.halted} data-testid="vault-deposit" onClick={() => void run("vault_deposit", { raw: (x.cc ? BigInt(Math.round(amount * x.rawPerToken)) : BigInt(Math.round(amount * 1e6))).toString() })}>
          {v.halted ? "Vault halted" : amount > 0 ? `Queue ${usdK(amount)} ${x.unit} for the roll` : "Enter an amount"}
        </button>
      )}
      <p className="small muted" style={{ margin: "8px 0 0" }}>Paid risk, not yield. Withdrawals leave at a roll, pro rata in {x.unit} and {x.otherUnit}.</p>
      <TxStatus state={tx.state} onRetry={() => tx.reset()} />

      {publicKey ? (
        <div className="vpanel" style={{ marginTop: 12 }}>
          <div className="h6">Your position</div>
          <Rows rows={[
            { k: "Shares", v: <span className="mono">{usdK(myShares)} · about {usdK(myShares * x.navPerShare)} {x.unit}</span> },
            { k: "Queued to enter", v: <span className="mono" data-testid="my-queued-deposit">{usdK(queuedDeposit)} {x.unit}{pos?.queuedDepositEpoch !== null && pos?.queuedDepositEpoch !== undefined ? ` (epoch ${pos.queuedDepositEpoch})` : ""}</span> },
            { k: "Queued to leave", v: <span className="mono">{usdK(queuedWithdraw)} shares{pos?.queuedWithdrawEpoch !== null && pos?.queuedWithdrawEpoch !== undefined ? ` (epoch ${pos.queuedWithdrawEpoch})` : ""}</span> },
          ]} />
          {claimable && claimEpoch !== null ? <button className="btn primary sm" style={{ marginTop: 10 }} disabled={busy} data-testid="vault-claim" onClick={() => void run("vault_claim", { epoch: claimEpoch })}>Claim epoch {claimEpoch}</button> : null}
          {myShares > 0 ? (
            <div style={{ marginTop: 12 }}>
              <label className="lbl">Withdraw shares</label>
              <div className="flex items-center gap-2">
                <input className="field mono" type="number" min={0} step={0.000001} max={myShares} value={withdrawShares} onChange={(e) => setWithdrawShares(Math.max(0, Math.min(myShares, Number(e.target.value) || 0)))} style={{ flex: 1, minWidth: 0 }} data-testid="vault-withdraw-shares" />
                <button className="btn secondary sm" onClick={() => setWithdrawShares(myShares)}>All</button>
              </div>
              <button className="btn primary sm" style={{ marginTop: 8, width: "100%" }} disabled={busy || withdrawShares <= 0} data-testid="vault-withdraw" onClick={() => void run("vault_request_withdraw", { shares: BigInt(Math.round(withdrawShares * 1e6)).toString() })}>Queue for the roll</button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
