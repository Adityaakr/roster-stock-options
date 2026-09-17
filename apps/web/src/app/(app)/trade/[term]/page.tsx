"use client";

import Link from "next/link";
import { use, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { PayoffChart } from "@/components/payoff-chart";
import { Slider } from "@/components/landing/examples";
import { Badge, ErrorState, KV, Loading } from "@/components/ui";
import { useCluster } from "@/lib/cluster";
import { usd, usd0, usdSmart, dayLabel, countdown } from "@/lib/format";
import { askAtSize, breakEven, DEFAULT_SIZE, maxLoss, moveNeeded, productName } from "@/lib/model";
import { useRoster } from "@/lib/use-roster";

/*
 * Act (CLAUDE.md 5): the payoff slider with max loss pinned, the executable quote at the chosen size, the escrow that
 * will back the fill, and the disclosure line. Connect if absent, sign once, then Manage. Until the program deploys
 * the buy button explains that instead of pretending.
 */
export default function ActPage({ params }: { params: Promise<{ term: string }> }) {
  const { term: id } = use(params);
  const { data, error } = useRoster();
  const cluster = useCluster();
  const { publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const [size, setSize] = useState(DEFAULT_SIZE);
  const [expected, setExpected] = useState<number | null>(null);

  if (error) return <ErrorState message={`Could not read the term: ${error}`} next="Reload the page." />;
  if (!data) return <Loading what="the term" />;
  const t = data.terms.find((x) => x.id === id);
  if (!t) return <ErrorState message="This term is not live." next={<Link className="link" href="/trade">Back to the terms</Link>} />;

  const u = data.underlying;
  const q = askAtSize(t, size);
  const prem = q.ask * size;
  const fee = (prem * data.feeBps) / 10_000;
  const total = prem + fee;
  const be = breakEven(t.side, t.strike, q.ask);
  const mv = moveNeeded(t.side, t.strike, q.ask, u.mark);
  const ex = expected ?? Math.round(u.mark * (t.side === "call" ? 1.08 : 0.92));
  const name = productName(t.side);
  const live = data.underwriters.filter((w) => w.live).slice(0, q.underwriters);

  return (
    <div>
      <div className="small" style={{ marginBottom: 14 }}><Link className="muted" href="/trade">Terms</Link> <span className="muted">/</span> {name} ${usd0(t.strike)} · {dayLabel(t.expiryTs)}</div>
      <div className="page-head">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="h3">{name} at ${usd0(t.strike)} through {dayLabel(t.expiryTs)}</h1>
            <Badge dot tone="green">executable</Badge>
            <Badge>{u.wrapperTier}</Badge>
          </div>
          <p className="body-sm">{t.side === "call" ? `The right to buy ${u.symbol} at $${usd0(t.strike)} per share, any time until expiry.` : `The right to sell ${u.symbol} at $${usd0(t.strike)} per share, any time until expiry.`} Expires in {countdown(t.expiryTs, data.nowTs)}.</p>
        </div>
      </div>

      <div className="grid-2" style={{ gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 1fr)" }}>
        <div className="card">
          <div className="flex items-center justify-between gap-3 flex-wrap" style={{ padding: "16px 20px", borderBottom: "1px solid var(--line)" }}>
            <div>
              <div className="h6">Payoff at expiry for {size} {u.symbol}</div>
              <div className="small" style={{ marginTop: 4 }}>Drag the expected price. Profit, break-even and max loss update; max loss stays where it is.</div>
            </div>
            <span className="small">Mark <b className="mono ink">${usd(u.mark)}</b></span>
          </div>
          <div style={{ padding: "16px 12px 8px" }}>
            <PayoffChart side={t.side} strike={t.strike} premium={q.ask} shares={size} mark={u.mark} expected={ex} />
            <Slider value={ex} min={Math.round(u.mark * 0.8)} max={Math.round(u.mark * 1.2)} onChange={setExpected} label="Expected price at expiry" />
          </div>
          <div style={{ padding: "0 20px 20px" }}>
            <div className="grid-3">
              <div className="inset" style={{ padding: 12 }}><div className="small">Break-even</div><div className="h4 num">${usd(be)}</div></div>
              <div className="inset" style={{ padding: 12 }}><div className="small">Move needed</div><div className={`h4 num ${mv <= 0 ? "up" : ""}`}>{mv >= 0 ? "+" : "−"}{Math.abs(mv).toFixed(1)}%</div></div>
              <div className="inset" style={{ padding: 12 }}><div className="small">Maximum loss</div><div className="h4 num down">−${usdSmart(maxLoss(q.ask, size, data.feeBps))}</div></div>
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
          <div className="card pad">
            <div className="h6">The quote</div>
            <label className="lbl" style={{ marginTop: 12 }}>Size in {u.symbol}</label>
            <input className="field mono" type="number" min={1} step={1} value={size} onChange={(e) => setSize(Math.max(1, Math.floor(Number(e.target.value) || 1)))} aria-label="Size" />
            <div style={{ marginTop: 14 }}>
              <KV items={[
                { k: "Premium per share", v: <span className="mono">${usd(q.ask)}</span> },
                { k: `Premium for ${size}`, v: <span className="mono">${usdSmart(prem)}</span> },
                { k: `Fee, ${data.feeBps} bps`, v: <span className="mono">${usd(fee)}</span> },
                { k: "Total", v: <span className="mono ink" style={{ fontWeight: 500 }}>${usdSmart(total)}</span> },
                { k: "Split across", v: `${q.underwriters} underwriter${q.underwriters > 1 ? "s" : ""}` }
              ]} />
            </div>
            <div className="divider" style={{ margin: "16px 0" }} />
            <div className="small">Escrow backing this fill</div>
            <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
              {live.map((w) => (
                <div key={w.name} className="flex items-center justify-between gap-3 small">
                  <span>{w.name}</span>
                  <span className="mono">{w.account ?? "account linked at deploy"}</span>
                </div>
              ))}
            </div>
            <div className="divider" style={{ margin: "16px 0" }} />
            {!publicKey ? (
              <button className="btn primary wide" onClick={() => setVisible(true)}>Connect wallet to buy</button>
            ) : !cluster.programDeployed ? (
              <button className="btn primary wide" disabled>Buy {size} {u.symbol} {name}</button>
            ) : (
              <button className="btn primary wide">Buy {size} {u.symbol} {name} for ${usdSmart(total)}</button>
            )}
            {publicKey && !cluster.programDeployed ? (
              <div className="msg red" style={{ marginTop: 10 }} role="alert">The program is not deployed on the {cluster.label} cluster, so nothing can be signed yet. The quote above is what the button will send once it is. <Link className="link" href="/#risk">What is live</Link>.</div>
            ) : null}
            <p className="note" style={{ marginTop: 12 }}>Contracts can expire worthless. Maximum loss is the premium plus fees. {t.side === "call" ? "Exercising requires paying the strike in USDC." : "Exercising requires delivering the tokens."}</p>
          </div>
          <div className="card pad">
            <div className="h6">What happens next</div>
            <p className="body-sm" style={{ margin: "6px 0 0" }}>One transaction. Then the position appears under Positions with its mark, its countdown and exactly what exercising requires: {t.side === "call" ? `pay $${usd0(t.strike * size)} USDC, receive ${size} ${u.symbol}` : `deliver ${size} ${u.symbol}, receive $${usd0(t.strike * size)} USDC`}. If it is in the money by more than the keeper fee after expiry minus grace, it is auto-exercised for you.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
