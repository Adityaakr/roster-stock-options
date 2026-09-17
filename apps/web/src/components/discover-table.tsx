"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, Tabs } from "@/components/ui";
import { breakEven, costOf, DEFAULT_SIZE, maxLoss, moveNeeded, productName, SESSION_LABEL, type RosterData, type Side } from "@/lib/model";
import { dayLabel, countdown, usd, usdSmart } from "@/lib/format";

/*
 * Discover: the live terms of one market, one expiry at a time, each with premium, break-even, max loss at the chosen size
 * and the move the buyer needs. Wallet not required. Selecting a row is the transition to Act (CLAUDE.md 5).
 * `compact` renders the nearest expiry only, for the landing hero.
 */
export function DiscoverTable({ data, compact = false, initialSide = "call" }: { data: RosterData; compact?: boolean; initialSide?: Side }) {
  const router = useRouter();
  const [side, setSide] = useState<Side>(initialSide);
  const [size, setSize] = useState(DEFAULT_SIZE);
  const [expiry, setExpiry] = useState(data.expiries[0] ?? 0);
  const expiries = compact ? data.expiries.slice(0, 1) : data.expiries;
  const u = data.underlying;
  const rows = data.terms.filter((t) => t.side === side && t.expiryTs === expiry).sort((a, b) => (side === "call" ? a.strike - b.strike : b.strike - a.strike));
  const sess = SESSION_LABEL[data.session];

  return (
    <div>
      <div className="flex items-center gap-3 flex-wrap" style={{ marginBottom: 14 }}>
        <Tabs value={side} onChange={(v) => setSide(v as Side)} items={[{ id: "call", label: "Gap · upside" }, { id: "put", label: "Floor · exit" }]} />
        {expiries.length > 1 ? <Tabs value={String(expiry)} onChange={(v) => setExpiry(Number(v))} items={expiries.map((e) => ({ id: String(e), label: dayLabel(e) }))} /> : null}
        <label className="flex items-center gap-2 small" style={{ marginLeft: "auto" }}>
          Size
          <input className="field mono" type="number" min={1} step={1} value={size} onChange={(e) => setSize(Math.max(1, Math.floor(Number(e.target.value) || 1)))} style={{ width: 88, height: 34 }} aria-label="Size in NVDAx" />
          <span className="mono">{u.symbol}</span>
        </label>
      </div>
      <div className="flex items-center gap-2 flex-wrap small" style={{ marginBottom: 10 }}>
        <span>Mark <b className="mono ink">${usd(u.mark)}</b></span>
        <span className="muted">·</span>
        <Badge tone={data.session === "regular" ? "green" : "amber"} dot>{sess}</Badge>
        <span className="muted">·</span>
        <span>Token vs share basis <b className="mono ink">{u.basisBps === null ? "n/a, equity feed closed" : `${u.basisBps >= 0 ? "+" : ""}${u.basisBps} bps`}</b></span>
        <span className="muted">·</span>
        <span>Expiry <b className="mono ink">{dayLabel(expiry)}</b> in <b className="mono ink">{countdown(expiry, data.nowTs)}</b></span>
      </div>
      <div className="card scroll-x">
        <table className="table" style={{ minWidth: 760 }}>
          <thead>
            <tr>
              <th>{productName(side)} at</th>
              <th className="num">Premium / share</th>
              <th className="num">Cost for {size}</th>
              <th className="num">Break-even</th>
              <th className="num">Max loss</th>
              <th className="num">Move needed</th>
              <th className="num">Fillable</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={7} className="muted">No live terms at this expiry.</td></tr>
            ) : rows.map((t) => {
              const c = costOf(t, size, u.multiplier, data.feeBps);
              const q = { ask: c.fillable ? c.premium / size : null, underwriters: c.writers };
              if (q.ask === null) {
                return (
                  <tr key={t.id} className="row-link" onClick={() => router.push(`/trade/${t.id}`)} tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") router.push(`/trade/${t.id}`); }}>
                    <td>
                      <div style={{ fontWeight: 500, whiteSpace: "nowrap" }}>${usd(t.strike)} <span className="muted">per share</span></div>
                      <div className="small mono" style={{ whiteSpace: "nowrap" }}>{t.side === "call" ? "right to buy" : "right to sell"} through {dayLabel(t.expiryTs)}</div>
                    </td>
                    <td className="num muted" colSpan={5}>{t.capacity > 0 ? `not fillable at ${size}; ${Math.floor(t.capacity)} ${u.symbol} available` : "no ask resident on this term"}</td>
                    <td className="num">{Math.floor(t.capacity)} {u.symbol}</td>
                  </tr>
                );
              }
              const be = breakEven(t.side, t.strike, q.ask);
              const mv = moveNeeded(t.side, t.strike, q.ask, u.mark);
              const ml = maxLoss(q.ask, size, data.feeBps);
              return (
                <tr key={t.id} className="row-link" onClick={() => router.push(`/trade/${t.id}`)} tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") router.push(`/trade/${t.id}`); }}>
                  <td>
                    <div style={{ fontWeight: 500, whiteSpace: "nowrap" }}>${usd(t.strike)} <span className="muted">per share</span></div>
                    <div className="small mono" style={{ whiteSpace: "nowrap" }}>{t.side === "call" ? "right to buy" : "right to sell"} through {dayLabel(t.expiryTs)}{q.underwriters > 1 ? ` · ${q.underwriters} underwriters` : ""}</div>
                  </td>
                  <td className="num">${usd(q.ask)}</td>
                  <td className="num">${usdSmart(q.ask * size)}</td>
                  <td className="num">${usd(be)}</td>
                  <td className="num">${usdSmart(ml)}</td>
                  <td className={`num ${mv <= 0 ? "up" : ""}`}>{mv >= 0 ? "+" : "−"}{Math.abs(mv).toFixed(1)}%</td>
                  <td className="num">{Math.floor(t.capacity)} {u.symbol}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="note" style={{ marginTop: 10 }}>Contracts can expire worthless. Maximum loss is the premium plus fees. Exercising a call requires paying the strike.</p>
    </div>
  );
}
