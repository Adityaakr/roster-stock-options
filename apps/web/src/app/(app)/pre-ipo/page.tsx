"use client";

import { Address, Badge, KV } from "@/components/ui";
import { usd } from "@/lib/format";

/*
 * First Print (CLAUDE.md 5): registry of Tessera and PreStocks tokens with the rights profile, mark versus token price
 * and the implied discount, and the funded-exit terms. Every figure and mint below is from CLAUDE.md 2.4 and 2.5,
 * verified 2026-09-17; P4 replaces this table with the live Tessera and PreStocks reads.
 */
const REGISTRY = [
  { symbol: "tOpenAI", source: "Tessera", mint: "oPAiAikWTaFj9RYoRFD35ccfwhnMcB3ThgBZRHSkjTZ", mark: 812.79, token: null as number | null, holders: 8259, fee: "0.2% on every transfer" },
  { symbol: "tKalshi", source: "Tessera", mint: "TKLSidmLVt3cqGaaodG8tyRzoANfQwoh67AccjmubeZ", mark: 413.8, token: null as number | null, holders: 2605, fee: "0.2% on every transfer" },
  { symbol: "tSpaceX", source: "Tessera", mint: "TSPXcLV76s6V2zDiZQ18kBfcbnjaE2ZzNT3ga2Pd99v", mark: 423, token: null as number | null, holders: 1274, fee: "0.2% on every transfer" },
  { symbol: "OPENAI", source: "PreStocks", mint: "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF", mark: null as number | null, token: null as number | null, holders: null as number | null, fee: "read from the mint in P4" },
  { symbol: "SPACEX", source: "PreStocks", mint: "PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh", mark: 151.17, token: 122.52, holders: null as number | null, fee: "read from the mint in P4" }
];

const RIGHTS: Record<string, { what: string; rights: string; exit: string }> = {
  Tessera: { what: "Loan participation rights, not securities", rights: "No equity, no voting, no dividends", exit: "Redemption needs a liquidity event, lock-up expiry, Tessera receiving proceeds and an announced start date, with no time bound. Unclaimed proceeds are forfeited after the window; redemption is not automatic." },
  PreStocks: { what: "SPV exposure to a private company", rights: "No ownership, voting or dividend rights", exit: "A DEX where liquidity depends on finding a buyer. The mark-versus-token spread is the price of having no exit." }
};

export default function PreIpoPage() {
  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="h3">First Print</h1>
          <p className="body-sm">Funded exits on the assets with no exit at all. Rights profile, mark versus token price, and the redemption cliff on every ticket.</p>
        </div>
        <Badge tone="amber" dot>ships last</Badge>
      </div>
      <div className="card scroll-x">
        <table className="table">
          <thead>
            <tr><th>Token</th><th>Source</th><th>Mint</th><th className="num">Mark</th><th className="num">Token price</th><th className="num">Discount</th><th className="num">Holders</th><th>Transfer fee</th></tr>
          </thead>
          <tbody>
            {REGISTRY.map((r) => {
              const disc = r.mark && r.token ? ((r.mark - r.token) / r.mark) * 100 : null;
              return (
                <tr key={r.symbol}>
                  <td><div style={{ fontWeight: 500 }}>{r.symbol}</div><div className="small">{RIGHTS[r.source]?.what}</div></td>
                  <td><Badge tone={r.source === "Tessera" ? "purple" : "blue"}>{r.source}</Badge></td>
                  <td><Address value={r.mint} n={5} /></td>
                  <td className="num">{r.mark === null ? <span className="muted">read in P4</span> : `$${usd(r.mark)}`}</td>
                  <td className="num">{r.token === null ? <span className="muted">n/a</span> : `$${usd(r.token)}`}</td>
                  <td className="num">{disc === null ? <span className="muted">n/a</span> : <span className="down">{disc.toFixed(1)}%</span>}</td>
                  <td className="num">{r.holders === null ? <span className="muted">n/a</span> : r.holders.toLocaleString("en-US")}</td>
                  <td className="small">{r.fee}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="small" style={{ marginTop: 8 }}>Marks, holders and mints from the Tessera token-details API and the PreStocks API, read 2026-09-17. Funded-exit terms on these tokens are quoted fee-inclusive on both legs and ship in P4.</p>
      <div className="grid-2" style={{ marginTop: 16 }}>
        {Object.entries(RIGHTS).map(([k, v]) => (
          <div key={k} className="card pad">
            <div className="h6">{k} tokens</div>
            <div style={{ marginTop: 12 }}>
              <KV items={[{ k: "What it is", v: v.what }, { k: "Rights", v: v.rights }]} />
            </div>
            <div className="inset" style={{ padding: 12, marginTop: 12 }}>
              <div className="small" style={{ marginBottom: 4 }}>The exit today</div>
              <div className="body-sm" style={{ margin: 0 }}>{v.exit}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="card pad flex items-center justify-between gap-4 flex-wrap" style={{ marginTop: 16 }}>
        <div>
          <div className="h6">A funded exit is the only way to hold a known price on a known date.</div>
          <div className="small" style={{ marginTop: 4 }}>About 10,900 wallets hold tOpenAI and tKalshi today. Terms open here once Gap, Floor and Protected Buy have shipped.</div>
        </div>
        <button className="btn primary" disabled>Funded exits open in P4</button>
      </div>
    </div>
  );
}
