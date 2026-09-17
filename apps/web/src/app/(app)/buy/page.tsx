"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Badge, ErrorState, KV, Loading } from "@/components/ui";
import { useCluster } from "@/lib/cluster";
import { usd, usd0, usdK, usdSmart, dayLabel } from "@/lib/format";
import { useRoster } from "@/lib/use-roster";

/*
 * Protected Buy (CLAUDE.md 5): two buttons on NVDAx. Buy, or buy with a floor through a chosen expiry. The second shows
 * purchase cost, premium and protected proceeds together. One transaction (a Jupiter swap plus a Floor), then Manage.
 */
export default function BuyPage() {
  const { data, error } = useRoster();
  const cluster = useCluster();
  const { publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const [size, setSize] = useState(10);
  const [floorId, setFloorId] = useState<string | null>(null);

  if (error) return <ErrorState message={`Could not read the terms: ${error}`} next="Reload the page." />;
  if (!data) return <Loading what="the desk" />;
  const u = data.underlying;
  const floors = data.terms.filter((t) => t.side === "put");
  const f = floors.find((x) => x.id === floorId) ?? floors[0];
  const cost = u.mark * size;
  const prem = f ? f.ask * size : 0;
  const protectedAt = f ? f.strike * size : 0;

  const gate = (label: string) => !publicKey
    ? <button className="btn primary wide" onClick={() => setVisible(true)}>Connect wallet</button>
    : <button className="btn primary wide" disabled={!cluster.programDeployed}>{label}</button>;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="h3">Protected Buy</h1>
          <p className="body-sm">Buy {u.symbol}, or buy {u.symbol} with a floor through a date, in one transaction.</p>
        </div>
        <Badge tone="amber" dot>after Gap and Floor ship</Badge>
      </div>
      <div className="card pad" style={{ marginBottom: 16 }}>
        <label className="lbl">Size in {u.symbol}</label>
        <input className="field mono" type="number" min={1} step={1} value={size} onChange={(e) => setSize(Math.max(1, Math.floor(Number(e.target.value) || 1)))} style={{ maxWidth: 240 }} aria-label="Size" />
      </div>
      <div className="grid-2">
        <div className="card pad">
          <div className="h5">Buy</div>
          <p className="body-sm" style={{ margin: "6px 0 16px" }}>A swap into {u.symbol} through Jupiter at the current token price. No floor, no premium.</p>
          <KV items={[
            { k: "Token price", v: <span className="mono">${usd(u.mark)}</span> },
            { k: `Cost for ${size}`, v: <span className="mono ink" style={{ fontWeight: 500 }}>${usdSmart(cost)}</span> },
            { k: "Worst case", v: "the token price" }
          ]} />
          <div className="divider" style={{ margin: "16px 0" }} />
          {gate(`Buy ${size} ${u.symbol}`)}
        </div>
        <div className="card pad" style={{ boxShadow: "inset 0 2px 0 var(--ink)" }}>
          <div className="h5">Buy with a floor</div>
          <p className="body-sm" style={{ margin: "6px 0 16px" }}>The same swap, plus a Floor bought in the same transaction. Purchase cost, premium and protected proceeds, together.</p>
          <label className="lbl">Floor</label>
          <select className="field" value={f?.id ?? ""} onChange={(e) => setFloorId(e.target.value)} aria-label="Floor">
            {floors.map((x) => <option key={x.id} value={x.id}>${usdK(x.strike)} through {dayLabel(x.expiryTs)} · ${usd(x.ask)} per share</option>)}
          </select>
          <div style={{ marginTop: 14 }}>
            <KV items={[
              { k: `Purchase, ${size} ${u.symbol}`, v: <span className="mono">${usdSmart(cost)}</span> },
              { k: "Premium", v: <span className="mono">${usdSmart(prem)}</span> },
              { k: "Total", v: <span className="mono ink" style={{ fontWeight: 500 }}>${usdSmart(cost + prem)}</span> },
              { k: `Protected proceeds through ${f ? dayLabel(f.expiryTs) : "expiry"}`, v: <span className="mono up">${usdSmart(protectedAt)}</span> },
              { k: "Worst case", v: <span className="mono down">−${usdSmart(cost + prem - protectedAt)}</span> }
            ]} />
          </div>
          <div className="divider" style={{ margin: "16px 0" }} />
          {gate(`Buy ${size} ${u.symbol} with a $${f ? usd0(f.strike) : "–"} floor`)}
        </div>
      </div>
      {publicKey && !cluster.programDeployed ? <div className="msg red" style={{ marginTop: 12 }} role="alert">Program not deployed on {cluster.label}; nothing to sign yet. Protected Buy ships after Gap and Floor.</div> : null}
      <p className="note" style={{ marginTop: 12 }}>Contracts can expire worthless. Maximum loss on the floor is its premium plus fees; the floor pays only if exercised. The token price itself is not protected below the strike minus the premium.</p>
      <p className="small" style={{ marginTop: 14 }}>{data.source}</p>
    </div>
  );
}
