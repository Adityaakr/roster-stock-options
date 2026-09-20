"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { TxStatus } from "@/components/tx-status";
import { Address, Badge, ErrorState, KV, Loading } from "@/components/ui";
import { useCluster, explorerUrl } from "@/lib/cluster";
import { usd, usdK, countdown, timeLabel } from "@/lib/format";
import type { ServicesVault, ServicesVaultPosition } from "@/lib/services";
import { useTransaction } from "@/lib/tx";
import { useRoster } from "@/lib/use-roster";

/*
 * The supply side (Part 3): deposit the underlying into the Covered Call vault or USDC into the Cash-Secured Put
 * vault, and the vault writes into the book for you. Everything a depositor must know before depositing is on this
 * page: the queue (deposits enter at the next roll, withdrawals leave at it), the exact time of that roll, the
 * capacity, and every epoch's P&L so far, losing ones included. This is paid risk, disclosed as such, never yield.
 */
export default function VaultsPage() {
  const { data, error } = useRoster();
  const [vaults, setVaults] = useState<ServicesVault[] | null>(null);
  const [verr, setVerr] = useState<string | null>(null);
  const load = useCallback(() => {
    fetch("/api/vaults", { cache: "no-store" })
      .then(async (r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return (await r.json()) as ServicesVault[] | { error: string }; })
      .then((j) => { if (Array.isArray(j)) { setVaults(j); setVerr(null); } else setVerr(j.error); })
      .catch((e: unknown) => setVerr(e instanceof Error ? e.message : String(e)));
  }, []);
  useEffect(() => { load(); }, [load]);

  if (error) return <ErrorState message={`Could not read the markets: ${error}`} next="Reload the page." />;
  if (!data || vaults === null) return <Loading what="the vaults" />;
  if (verr) return <ErrorState message={`Could not read the vaults: ${verr}`} next="Reload the page." />;
  const nowTs = data.nowTs;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="h3" style={{ margin: 0 }}>Vaults</h1>
          <p className="body-sm" style={{ margin: "4px 0 0" }}>Deposit and the vault writes for you. Covered calls: you hold the stock, the vault sells its upside above a strike and you keep the premium, or you sell at the strike. Cash-secured puts: you hold USDC, the vault sells a floor below the mark and you keep the premium, or you buy at the strike.</p>
        </div>
      </div>
      <div className="msg" role="note" style={{ marginBottom: 16 }}>
        These vaults are short volatility with no hedge available on Solana, so they will have losing epochs and every epoch&apos;s result is published below, wins and losses alike. Deposits enter at the next roll; withdrawals leave at it. This is paid risk, not yield.
      </div>
      {vaults.length === 0 ? <ErrorState message="No vault is running on this cluster yet." next={<Link href="/underwrite">Write directly instead.</Link>} /> : null}
      <div style={{ display: "grid", gap: 16 }}>
        {vaults.map((v) => <VaultCard key={v.address} v={v} nowTs={nowTs} mark={data.markets.find((m) => m.symbol === v.symbol)?.mark ?? null} decimals={data.markets.find((m) => m.symbol === v.symbol)?.decimals ?? 8} multiplier={data.markets.find((m) => m.symbol === v.symbol)?.multiplier ?? 1} mint={data.markets.find((m) => m.symbol === v.symbol)?.mint ?? null} onChanged={load} />)}
      </div>
    </div>
  );
}

function VaultCard({ v, nowTs, mark, decimals, multiplier, mint, onChanged }: { v: ServicesVault; nowTs: number; mark: number | null; decimals: number; multiplier: number; mint: string | null; onChanged: () => void }) {
  const cluster = useCluster();
  const { publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const tx = useTransaction();
  const [amount, setAmount] = useState(1);
  const [withdrawShares, setWithdrawShares] = useState(0);
  const [pos, setPos] = useState<ServicesVaultPosition | null>(null);
  const cc = v.kind === "covered_call";
  const rawPerToken = 10 ** decimals;
  const lots = (raw: string) => (cc ? Number(raw) / rawPerToken : Number(raw) / 1e6);
  const unit = cc ? v.symbol : "USDC";
  const otherUnit = cc ? "USDC" : v.symbol;
  const totalShares = Number(v.totalShares) / 1e6;
  const collateral = lots(v.collateralBalance) + lots(v.lockedRaw) - lots(v.reservedCollateralRaw) - lots(v.pendingDepositRaw);
  const other = (cc ? Number(v.otherBalance) / 1e6 : Number(v.otherBalance) / rawPerToken) - (cc ? Number(v.reservedOther) / 1e6 : Number(v.reservedOther) / rawPerToken);
  // The vault's value per share in its collateral unit, with the other asset at the mark.
  const otherInCollateral = mark ? (cc ? other / (mark * multiplier) : other * mark * multiplier) : 0;
  const navPerShare = totalShares > 0 ? (collateral + otherInCollateral) / totalShares : 1;
  const me = publicKey?.toBase58() ?? null;

  const loadPos = useCallback(() => {
    const url = me ? `/api/vaults/${v.address}/position/${me}` : null;
    // A disconnected wallet resolves to no position through the same asynchronous path, so the effect sets no state itself.
    (url ? fetch(url, { cache: "no-store" }).then((r) => (r.ok ? (r.json() as Promise<ServicesVaultPosition>) : null)) : Promise.resolve(null)).then((j) => setPos(j)).catch(() => setPos(null));
  }, [me, v.address]);
  useEffect(() => { loadPos(); }, [loadPos]);

  const busy = tx.state.status === "building" || tx.state.status === "signing" || tx.state.status === "sending";
  const myShares = pos ? Number(pos.shares) / 1e6 : 0;
  const queuedDeposit = pos ? lots(pos.queuedDepositRaw) : 0;
  const queuedWithdraw = pos ? Number(pos.queuedWithdrawShares) / 1e6 : 0;
  const claimable = pos && ((Number(pos.queuedDepositRaw) > 0 && pos.queuedDepositEpoch !== null && pos.queuedDepositEpoch < v.epoch) || (Number(pos.queuedWithdrawShares) > 0 && pos.queuedWithdrawEpoch !== null && pos.queuedWithdrawEpoch < v.epoch));
  const claimEpoch = pos ? (Number(pos.queuedDepositRaw) > 0 ? pos.queuedDepositEpoch : pos.queuedWithdrawEpoch) : null;

  async function run(kind: "vault_deposit" | "vault_request_withdraw" | "vault_claim", params: Record<string, string | number | null>) {
    if (!mint) return;
    const sig = await tx.run({ kind, mint, series: "", params: { kind: v.kind, ...params } });
    if (sig) { onChanged(); loadPos(); }
  }

  // Three adverse scenarios in real numbers for the amount typed, so the risk is read before the deposit is made.
  const strikeGuess = mark ? (cc ? mark * 1.025 : mark * 0.975) : null;
  const scenarios = mark && strikeGuess ? (cc ? [mark * 1.05, mark * 1.1, mark * 1.2] : [mark * 0.95, mark * 0.9, mark * 0.8]).map((p) => ({ p, loss: cc ? Math.max(0, p - strikeGuess) * amount : Math.max(0, strikeGuess - p) * (amount / strikeGuess) })) : [];

  return (
    <div className="card pad" data-testid="vault">
      <div className="flex items-center gap-2 flex-wrap" style={{ marginBottom: 6 }}>
        <h2 className="h5" style={{ margin: 0 }}>{cc ? "Covered Call" : "Cash-Secured Put"} · {v.symbol}</h2>
        <Badge tone={v.halted ? "amber" : "green"} dot>{v.halted ? "halted" : "quoting"}</Badge>
        <Badge>epoch {v.epoch}</Badge>
        <span className="small muted">rolls every {Math.round(v.rollIntervalSecs / 3600)}h · next roll {timeLabel(v.nextRollTs)} · in {countdown(v.nextRollTs, nowTs)}</span>
      </div>
      <div className="grid-2 split-left">
        <div>
          <KV items={[
            { k: `${unit} in the vault`, v: <span className="mono">{usdK(collateral)} {unit}</span> },
            { k: `${otherUnit} held`, v: <span className="mono">{usdK(other)} {otherUnit}</span> },
            { k: "Value per share", v: <span className="mono">{navPerShare.toFixed(4)} {unit}</span> },
            { k: "Shares", v: <span className="mono">{usdK(totalShares)}</span> },
            { k: "Locked in live series", v: <span className="mono">{usdK(lots(v.lockedRaw))} {unit}</span> },
            { k: "Queued to enter at the roll", v: <span className="mono">{usdK(lots(v.pendingDepositRaw))} {unit}</span> },
            { k: "Queued to leave at the roll", v: <span className="mono">{usdK(Number(v.pendingWithdrawShares) / 1e6)} shares</span> },
            { k: "Cap per series", v: <span className="mono">{usdK(Number(v.capPerSeriesLots6) / 1e6)} lots</span> },
            { k: "This epoch so far", v: <span className="mono">{usd(Number(v.epochPremiumIn) / 1e6)} USDC premium in · {usd(Number(v.epochBuybackOut) / 1e6)} paid on buybacks · {usdK(Number(v.epochAssignedLots6) / 1e6)} lots assigned</span> },
            { k: "Vault account", v: <Address value={v.address} href={explorerUrl(cluster, "address", v.address)} /> },
            { k: "Share mint", v: <Address value={v.shareMint} href={explorerUrl(cluster, "address", v.shareMint)} /> },
          ]} />
          <div className="h6" style={{ marginTop: 18 }}>Epochs</div>
          {v.epochs.length === 0 ? <p className="small muted">No epoch has rolled yet.</p> : (
            <table className="table">
              <thead><tr><th>Epoch</th><th>Rolled</th><th className="num">Premium in</th><th className="num">Buybacks</th><th className="num">Assigned</th><th className="num">P&amp;L per share</th><th className="num">Mark</th></tr></thead>
              <tbody>
                {[...v.epochs].reverse().map((e) => {
                  const pnl = Number(e.pnlPerShare1e6) / 1e6 / (cc ? rawPerToken / 1e6 : 1);
                  return (
                    <tr key={e.epoch} data-testid="vault-epoch">
                      <td className="mono">{e.epoch}</td>
                      <td>{timeLabel(e.rolledAt)}</td>
                      <td className="num">{usd(Number(e.premiumIn) / 1e6)}</td>
                      <td className="num">{usd(Number(e.buybackOut) / 1e6)}</td>
                      <td className="num">{usdK(Number(e.assignedLots6) / 1e6)} lots</td>
                      <td className={`num ${pnl < 0 ? "down" : pnl > 0 ? "up" : ""}`}>{pnl === 0 ? "0" : `${pnl > 0 ? "+" : "−"}${Math.abs(pnl).toFixed(6)} ${unit}`}</td>
                      <td className="num">${usd(Number(e.markUsdcPerLot) / 1e6)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <div>
          <div className="card pad" style={{ background: "var(--surface)" }}>
            <div className="h6">Deposit {unit}</div>
            <p className="small muted" style={{ margin: "4px 0 10px" }}>Enters at the next roll, {timeLabel(v.nextRollTs)}. Until then it sits in the vault untouched and can be withdrawn by claiming nothing.</p>
            <label className="lbl">Amount</label>
            <input className="field mono" type="number" min={0.01} step={0.01} value={amount} onChange={(e) => setAmount(Math.max(0, Number(e.target.value) || 0))} data-testid="vault-amount" />
            {scenarios.length ? (
              <div className="small" style={{ marginTop: 10 }}>
                <div className="muted">What assignment would cost you at three adverse prices, before the premium you collect:</div>
                {scenarios.map((s) => <div key={s.p} className="mono">{cc ? `${v.symbol} at $${usd(s.p)}: you sell at the strike and forgo about $${usd(s.loss)}` : `${v.symbol} at $${usd(s.p)}: you buy at the strike, about $${usd(s.loss)} above the market`}</div>)}
              </div>
            ) : null}
            {!publicKey ? (
              <button className="btn primary" style={{ marginTop: 12 }} onClick={() => setVisible(true)}>Connect wallet</button>
            ) : (
              <button className="btn primary" style={{ marginTop: 12 }} disabled={busy || amount <= 0 || !cluster.programDeployed} data-testid="vault-deposit" onClick={() => void run("vault_deposit", { raw: (cc ? BigInt(Math.round(amount * rawPerToken)) : BigInt(Math.round(amount * 1e6))).toString() })}>
                Queue {usdK(amount)} {unit} for the next roll
              </button>
            )}
          </div>
          {publicKey ? (
            <div className="card pad" style={{ marginTop: 12 }}>
              <div className="h6">Your position</div>
              <KV items={[
                { k: "Shares", v: <span className="mono">{usdK(myShares)} · about {usdK(myShares * navPerShare)} {unit}</span> },
                { k: "Queued to enter", v: <span className="mono" data-testid="my-queued-deposit">{usdK(queuedDeposit)} {unit}{pos?.queuedDepositEpoch !== null && pos?.queuedDepositEpoch !== undefined ? ` (epoch ${pos.queuedDepositEpoch})` : ""}</span> },
                { k: "Queued to leave", v: <span className="mono">{usdK(queuedWithdraw)} shares{pos?.queuedWithdrawEpoch !== null && pos?.queuedWithdrawEpoch !== undefined ? ` (epoch ${pos.queuedWithdrawEpoch})` : ""}</span> },
              ]} />
              {claimable && claimEpoch !== null ? (
                <button className="btn primary sm" style={{ marginTop: 10 }} disabled={busy} data-testid="vault-claim" onClick={() => void run("vault_claim", { epoch: claimEpoch })}>Claim epoch {claimEpoch}</button>
              ) : null}
              {myShares > 0 ? (
                <div style={{ marginTop: 12 }}>
                  <label className="lbl">Withdraw shares</label>
                  <div className="flex items-center gap-2">
                    <input className="field mono" type="number" min={0} step={0.000001} max={myShares} value={withdrawShares} onChange={(e) => setWithdrawShares(Math.max(0, Math.min(myShares, Number(e.target.value) || 0)))} style={{ maxWidth: 200 }} data-testid="vault-withdraw-shares" />
                    <button className="btn secondary sm" onClick={() => setWithdrawShares(myShares)}>All</button>
                    <button className="btn primary sm" disabled={busy || withdrawShares <= 0} data-testid="vault-withdraw" onClick={() => void run("vault_request_withdraw", { shares: BigInt(Math.round(withdrawShares * 1e6)).toString() })}>Queue for the roll</button>
                  </div>
                  <p className="small muted" style={{ margin: "6px 0 0" }}>Paid at the roll in {unit} and {otherUnit}, pro rata of what the vault holds then; claim it here after the roll.</p>
                </div>
              ) : null}
            </div>
          ) : null}
          <TxStatus state={tx.state} onRetry={() => tx.reset()} />
        </div>
      </div>
    </div>
  );
}
