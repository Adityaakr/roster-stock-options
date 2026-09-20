"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MarketLogo } from "@/components/market-list";
import { Badge, ErrorState, Loading } from "@/components/ui";
import { usd, usd0, usdK, countdown } from "@/lib/format";
import { pnlLabel, useVaults, vaultView, type VaultView } from "@/lib/vaults";
import { useRoster } from "@/lib/use-roster";

/*
 * The vaults (Part 3): every vault the protocol runs, as a table a depositor can scan and sort. Deposits are what
 * the vault holds at the mark; exposure is what is locked behind live contracts right now; the last epoch's result is
 * shown with its sign because it is a result, not a rate. Click a row for the vault itself.
 */
type Kind = "all" | "covered_call" | "cash_secured_put";
type SortKey = "deposits" | "exposure" | "last" | "roll";

export default function VaultsPage() {
  const router = useRouter();
  const { data, error } = useRoster();
  const { vaults, error: verr } = useVaults();
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<Kind>("all");
  const [asset, setAsset] = useState<string>("all");
  const [sort, setSort] = useState<SortKey>("deposits");

  const views = useMemo(() => (vaults ?? []).map((v) => vaultView(v, data?.markets.find((m) => m.symbol === v.symbol))), [vaults, data]);
  const assets = useMemo(() => [...new Set(views.map((x) => x.unit))].sort(), [views]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out = views.filter((x) => (kind === "all" || x.v.kind === kind) && (asset === "all" || x.unit === asset) && (!needle || `${x.v.symbol} ${x.kindLabel} ${x.unit}`.toLowerCase().includes(needle)));
    const key = (x: VaultView) => sort === "deposits" ? x.depositsUsd ?? x.collateral : sort === "exposure" ? x.lockedUsd ?? x.locked : sort === "last" ? x.lastPnlPct ?? -Infinity : -x.v.nextRollTs;
    return out.sort((a, b) => key(b) - key(a));
  }, [views, q, kind, asset, sort]);
  const totalUsd = views.reduce((a, x) => a + (x.depositsUsd ?? 0), 0);

  if (error) return <ErrorState message={`Could not read the markets: ${error}`} next="Reload the page." />;
  if (verr) return <ErrorState message={`Could not read the vaults: ${verr}`} next="Reload the page." />;
  if (!data || vaults === null) return <Loading what="the vaults" />;
  const nowTs = data.nowTs;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Vaults</h1>
          <p>Deposit and the vault writes into the book for you. Paid risk, disclosed as such: every epoch&apos;s result is published with its sign.</p>
        </div>
        <div className="chip-stat"><span>Total deposits</span><b className="mono">${usd0(totalUsd)}</b></div>
      </div>

      <div className="card vlist">
        <div className="vlist-bar">
          <div className="flex items-center gap-2 flex-wrap">
            <Seg value={kind} onChange={(v) => setKind(v as Kind)} items={[["all", "All"], ["covered_call", "Covered Call"], ["cash_secured_put", "Cash-Secured Put"]]} />
            <Seg value={asset} onChange={setAsset} items={[["all", "Any asset"], ...assets.map((a) => [a, a] as [string, string])]} />
          </div>
          <input className="field" placeholder="Filter vaults" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter vaults" style={{ maxWidth: 240, height: 34 }} />
        </div>
        <div className="mlist">
          <table className="table mtable vtable-list">
            <thead>
              <tr>
                <th>Vault</th>
                <th>Status</th>
                <th className="num sortable" onClick={() => setSort("deposits")} aria-sort={sort === "deposits" ? "descending" : "none"}>Deposits {sort === "deposits" ? "↓" : ""}</th>
                <th className="num sortable" onClick={() => setSort("exposure")} aria-sort={sort === "exposure" ? "descending" : "none"}>Exposure {sort === "exposure" ? "↓" : ""}</th>
                <th>Writes</th>
                <th className="num sortable" onClick={() => setSort("last")} aria-sort={sort === "last" ? "descending" : "none"}>Last epoch {sort === "last" ? "↓" : ""}</th>
                <th className="num sortable" onClick={() => setSort("roll")} aria-sort={sort === "roll" ? "descending" : "none"}>Next roll {sort === "roll" ? "↓" : ""}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? <tr><td colSpan={7} className="muted" style={{ padding: 20 }}>No vault matches.</td></tr> : null}
              {rows.map((x) => {
                const market = data.markets.find((m) => m.symbol === x.v.symbol);
                const href = `/vaults/${x.v.address}`;
                return (
                  <tr key={x.v.address} className="rowlink" onClick={() => router.push(href)} data-testid="vault-row">
                    <td>
                      <div className="flex items-center gap-3">
                        {market ? <MarketLogo m={market} size={30} /> : null}
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 500, whiteSpace: "nowrap" }}><Link href={href} onClick={(e) => e.stopPropagation()}>{x.v.symbol} {x.kindLabel}</Link></div>
                          <div className="small muted">{x.cc ? "sells calls above the mark" : "sells puts below the mark"}</div>
                        </div>
                      </div>
                    </td>
                    <td><Badge tone={x.v.halted ? "amber" : "green"} dot>{x.v.halted ? "halted" : "quoting"}</Badge></td>
                    <td className="num">
                      <div className="mono">{usdK(x.collateral + x.otherInCollateral)} {x.unit}</div>
                      <div className="small muted mono">{x.depositsUsd !== null ? `$${usd0(x.depositsUsd)}` : "no mark"}</div>
                    </td>
                    <td className="num">
                      <div className="mono">{usdK(x.locked)} {x.unit}</div>
                      <div className="small muted mono">{x.collateral > 0 ? `${Math.round((x.locked / x.collateral) * 100)}% locked` : "nothing locked"}</div>
                    </td>
                    <td><div className="small">{x.cc ? "Calls" : "Puts"} on {x.v.symbol}</div><div className="small muted">cap {usdK(x.capLots)} lots</div></td>
                    <td className={`num mono ${x.lastPnlPerShare === null ? "muted" : x.lastPnlPerShare < 0 ? "down" : x.lastPnlPerShare > 0 ? "up" : ""}`}>
                      <div>{x.lastPnlPct !== null ? `${x.lastPnlPct >= 0 ? "+" : "−"}${(Math.abs(x.lastPnlPct) * 100).toFixed(2)}%` : x.lastPnlPerShare === null ? "no epoch yet" : pnlLabel(x.lastPnlPerShare, x.unit)}</div>
                      <div className="small muted">${usd(x.premiumIn)} so far</div>
                    </td>
                    <td className="num mono">
                      <div>{countdown(x.v.nextRollTs, nowTs)}</div>
                      <div className="small muted">{Math.round(x.v.rollIntervalSecs / 3600)}h cycle</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <p className="small muted" style={{ marginTop: 12 }}>Deposits count what the vault holds at the mark, including USDC it has earned. Exposure is what is locked behind live contracts right now. The last epoch is a result, not a rate; these vaults are short volatility with no hedge and will have losing epochs.</p>
    </div>
  );
}

function Seg({ value, onChange, items }: { value: string; onChange: (v: string) => void; items: [string, string][] }) {
  return (
    <div className="tabs" role="tablist">
      {items.map(([id, label]) => <button key={id} role="tab" aria-selected={value === id} onClick={() => onChange(id)}>{label}</button>)}
    </div>
  );
}
