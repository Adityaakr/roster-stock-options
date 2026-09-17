"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, ErrorState, Loading, Stat } from "@/components/ui";
import { usd, usd0, dayLabel, timeLabel } from "@/lib/format";
import { productName } from "@/lib/model";
import { useRoster } from "@/lib/use-roster";

/*
 * Roster (CLAUDE.md 5): the executable-protection page. Quotes at sizes, reserved capital with accounts, capacity,
 * exercise history including failures, and which underwriters are live.
 */
export default function RosterPage() {
  const { data, error } = useRoster();
  const router = useRouter();
  if (error) return <ErrorState message={`Could not read the roster: ${error}`} next="Reload the page." />;
  if (!data) return <Loading what="the roster" />;
  const sym = data.underlying.symbol;
  const usdcTotal = data.underwriters.reduce((a, u) => a + u.usdcReserved, 0);
  const tokTotal = data.underwriters.reduce((a, u) => a + u.underlyingReserved, 0);
  const capacity = data.terms.reduce((a, t) => a + (t.capacity - t.openInterest), 0);
  const oi = data.terms.reduce((a, t) => a + t.openInterest, 0);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="h3">Roster</h1>
          <p className="body-sm">The standing list of who is committed: capital locked, quotes live, and every exercise, including the ones that failed.</p>
        </div>
        <Badge tone={data.underwriters.some((u) => u.live) ? "green" : "amber"} dot>{data.underwriters.filter((u) => u.live).length} underwriters live</Badge>
      </div>
      <div className="grid-4" style={{ marginBottom: 16 }}>
        <Stat k="USDC reserved" v={`$${usd0(usdcTotal)}`} s="backing Floors" />
        <Stat k={`${sym} reserved`} v={`${tokTotal}`} s="backing Gaps" />
        <Stat k="Fillable now" v={`${capacity} ${sym}`} s="across every live term" />
        <Stat k="Open interest" v={`${oi} ${sym}`} s="filled and not yet exercised" />
      </div>

      <div className="card scroll-x" style={{ marginBottom: 16 }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--line)" }}>
          <div className="h6">Quotes at three sizes</div>
          <div className="small" style={{ marginTop: 4 }}>Each ask is executable at the size shown and backed by escrow. Wider sizes pay more.</div>
        </div>
        <table className="table">
          <thead>
            <tr><th>Term</th><th className="num">10 {sym}</th><th className="num">50 {sym}</th><th className="num">200 {sym}</th><th className="num">Fillable</th><th className="num">Open</th></tr>
          </thead>
          <tbody>
            {data.terms.map((t) => (
              <tr key={t.id} className="row-link" onClick={() => router.push(`/trade/${t.id}`)}>
                <td><div style={{ fontWeight: 500 }}>{productName(t.side)} ${usd0(t.strike)}</div><div className="small mono">{dayLabel(t.expiryTs)}</div></td>
                {t.ladder.map((r) => <td key={r.size} className="num">${usd(r.ask)} <span className="small muted">×{r.underwriters}</span></td>)}
                <td className="num">{t.capacity - t.openInterest}</td>
                <td className="num">{t.openInterest}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid-2" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.4fr)" }}>
        <div className="card">
          <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--line)" }}>
            <div className="h6">Reserved capital</div>
            <div className="small" style={{ marginTop: 4 }}>With the escrow accounts, once the program is deployed.</div>
          </div>
          <table className="table">
            <thead><tr><th>Underwriter</th><th className="num">USDC</th><th className="num">{sym}</th><th>Account</th></tr></thead>
            <tbody>
              {data.underwriters.map((u) => (
                <tr key={u.name}>
                  <td><div className="flex items-center gap-2">{u.name} <Badge tone={u.live ? "green" : "amber"} dot>{u.live ? "live" : "idle"}</Badge></div></td>
                  <td className="num">${usd0(u.usdcReserved)}</td>
                  <td className="num">{u.underlyingReserved}</td>
                  <td className="small mono">{u.account ?? "linked at deploy"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ padding: "12px 20px" }}>
            <div className="bar" role="img" aria-label={`Capacity used: ${oi} of ${oi + capacity}`}>
              <span style={{ width: `${(oi / Math.max(1, oi + capacity)) * 100}%`, background: "var(--ink)" }} />
            </div>
            <div className="small" style={{ marginTop: 6 }}>{oi} {sym} open of {oi + capacity} {sym} committed.</div>
          </div>
        </div>
        <div className="card">
          <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--line)" }}>
            <div className="h6">Exercise history</div>
            <div className="small" style={{ marginTop: 4 }}>Every exercise, auto-exercise and release, with the signature, including the ones that declined.</div>
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
                    <td className="small mono">{e.signature ?? "no signature on this cluster"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <div className="card pad flex items-center justify-between gap-4 flex-wrap" style={{ marginTop: 16 }}>
        <div>
          <div className="h6">Want to be on the roster?</div>
          <div className="small" style={{ marginTop: 4 }}>Lock USDC or {sym}, publish an ask, get paid when it fills. Paid risk, disclosed as such.</div>
        </div>
        <Link href="/underwrite" className="btn primary">Underwrite a term</Link>
      </div>
      <p className="small" style={{ marginTop: 14 }}>{data.source}</p>
    </div>
  );
}
