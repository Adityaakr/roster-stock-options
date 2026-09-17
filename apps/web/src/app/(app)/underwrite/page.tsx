"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { ErrorState, KV, Loading, Tabs } from "@/components/ui";
import { useCluster } from "@/lib/cluster";
import { usd, usd0, usdSmart, dayLabel } from "@/lib/format";
import { commitMath, DEFAULT_SIZE, type Side } from "@/lib/model";
import { useRoster } from "@/lib/use-roster";

/*
 * Commit (CLAUDE.md 5): choose side and term, enter size, see what is locked, the premium at the current ask, the
 * effective acquisition or sale price, and the loss at three adverse prices. Disclosure: capital is locked until
 * expiry or exercise; this is paid risk.
 */
export default function UnderwritePage() {
  const { data, error } = useRoster();
  const cluster = useCluster();
  const { publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const [side, setSide] = useState<Side>("put");
  const [termId, setTermId] = useState<string | null>(null);
  const [size, setSize] = useState(20);
  const [ask, setAsk] = useState<number | null>(null);

  if (error) return <ErrorState message={`Could not read the terms: ${error}`} next="Reload the page." />;
  if (!data) return <Loading what="terms" />;
  const terms = data.terms.filter((t) => t.side === side);
  const t = terms.find((x) => x.id === termId) ?? terms[0];
  if (!t) return <ErrorState message="No live terms to underwrite." />;
  const myAsk = ask ?? t.ask;
  const m = commitMath(side, t.strike, myAsk, size);
  const sym = data.underlying.symbol;
  const adverse = side === "put" ? [t.strike * 0.95, t.strike * 0.9, t.strike * 0.8] : [t.strike * 1.05, t.strike * 1.1, t.strike * 1.2];
  const lossAt = (p: number) => (side === "put" ? Math.max(0, t.strike - p) * size : Math.max(0, p - t.strike) * size) - m.premium;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="h3">Underwrite</h1>
          <p className="body-sm">Get paid to take the other side. Lock the collateral, publish an ask, collect the premium when it fills.</p>
        </div>
      </div>
      <div className="grid-2" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.4fr)" }}>
        <div className="card pad">
          <Tabs value={side} onChange={(v) => { setSide(v as Side); setTermId(null); setAsk(null); }} items={[{ id: "put", label: "Write Floors · get paid to buy lower" }, { id: "call", label: "Write Gaps · get paid to sell higher" }]} />
          <label className="lbl" style={{ marginTop: 16 }}>Term</label>
          <select className="field" value={t.id} onChange={(e) => { setTermId(e.target.value); setAsk(null); }} aria-label="Term">
            {terms.map((x) => <option key={x.id} value={x.id}>${usd0(x.strike)} through {dayLabel(x.expiryTs)} · current ask ${usd(x.ask)}</option>)}
          </select>
          <div className="grid-2" style={{ marginTop: 12 }}>
            <div>
              <label className="lbl">Size in {sym}</label>
              <input className="field mono" type="number" min={1} step={1} value={size} onChange={(e) => setSize(Math.max(1, Math.floor(Number(e.target.value) || DEFAULT_SIZE)))} aria-label="Size" />
            </div>
            <div>
              <label className="lbl">Your ask per share</label>
              <input className="field mono" type="number" min={0.01} step={0.05} value={myAsk} onChange={(e) => setAsk(Math.max(0.01, Number(e.target.value) || 0.01))} aria-label="Ask per share" />
            </div>
          </div>
          <div className="divider" style={{ margin: "16px 0" }} />
          <KV items={[
            { k: side === "put" ? "USDC to lock" : `${sym} to lock`, v: <span className="mono ink" style={{ fontWeight: 500 }}>{side === "put" ? `$${usd0(m.locked)}` : `${m.locked} ${sym}`}</span> },
            { k: "Premium you receive", v: <span className="mono up">${usdSmart(m.premium)}</span> },
            { k: side === "put" ? "Effective buy price if assigned" : "Effective sale price if assigned", v: <span className="mono">${usd(m.effective)}</span> },
            { k: "Locked until", v: `${dayLabel(t.expiryTs)} or exercise` }
          ]} />
          <div className="divider" style={{ margin: "16px 0" }} />
          {!publicKey ? (
            <button className="btn primary wide" onClick={() => setVisible(true)}>Connect wallet to quote</button>
          ) : (
            <button className="btn primary wide" disabled={!cluster.programDeployed}>Lock {side === "put" ? `$${usd0(m.locked)}` : `${m.locked} ${sym}`} and quote</button>
          )}
          {publicKey && !cluster.programDeployed ? <div className="msg red" style={{ marginTop: 10 }} role="alert">Program not deployed on {cluster.label}; nothing to sign yet.</div> : null}
          <p className="note" style={{ marginTop: 12 }}>Capital is locked until expiry or exercise. This is paid risk, not yield: if the price moves through the strike you are assigned at it.</p>
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
                      <td className="num">{side === "put" ? `buy ${size} at $${usd0(t.strike)}` : `sell ${size} at $${usd0(t.strike)}`}</td>
                      <td className="num up">+${usdSmart(m.premium)}</td>
                      <td className="num down">−${usdSmart(lossAt(p))}</td>
                    </tr>
                  ))}
                  <tr><td>Not assigned</td><td className="num muted">collateral released at expiry</td><td className="num up">+${usdSmart(m.premium)}</td><td className="num up">+${usdSmart(m.premium)}</td></tr>
                </tbody>
              </table>
            </div>
          </div>
          <div className="card pad">
            <div className="h6">After you quote</div>
            <p className="body-sm" style={{ margin: "6px 0 0" }}>Your ask goes live on the roster next to the treasury and the maker bot. Buyers match the cheapest asks first, so a fill can be partial. Premium arrives with each fill. At expiry the unexercised collateral is released back to you; an exercise assigns you at the strike.</p>
          </div>
        </div>
      </div>
      <p className="small" style={{ marginTop: 14 }}>{data.source}</p>
    </div>
  );
}
