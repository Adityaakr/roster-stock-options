"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { MarketLogo } from "@/components/market-list";
import { Badge } from "@/components/ui";
import { usdSmart, dayLabel } from "@/lib/format";
import { productName } from "@/lib/model";

/*
 * The intent box: say what you want, review the ticket, sign. The model only maps the sentence to a market, a side,
 * a size and a horizon; the app picks the term and prices it with the same walk the Act screen uses, so every figure
 * here is the app's own arithmetic. The box is absent when the deployment has no key.
 */
interface Proposal {
  action: "buy_gap" | "buy_floor" | "write_floor" | "write_gap";
  market: { symbol: string; name: string; logo: string | null; mark: number };
  term: { id: string; side: "call" | "put"; strike: number; expiryTs: number; capacity: number };
  size: number; premium: number; fee: number; total: number; breakEven: number; movePct: number;
  locked: { amount: number; unit: string } | null;
  href: string; explanation: string; caveats: string[];
}

const EXAMPLES = ["$200 of Nvidia upside through Friday", "protect my 20 NVDAx through earnings", "get paid to buy Tesla 10% lower"];

export function IntentBox({ compact = false }: { compact?: boolean }) {
  const [enabled, setEnabled] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Proposal | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/intent", { cache: "no-store" }).then((r) => r.json()).then((j: { enabled?: boolean }) => setEnabled(!!j.enabled)).catch(() => setEnabled(false));
  }, []);
  if (!enabled) return null;

  async function ask(q: string) {
    const t = q.trim();
    if (!t || busy) return;
    setText(t);
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await fetch("/api/intent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: t }) });
      const j = (await r.json()) as Proposal | { error: string };
      if ("error" in j) setError(j.error);
      else setResult(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const buying = result?.action.startsWith("buy");
  return (
    <section className={`card intent ${compact ? "compact" : ""}`} data-testid="intent">
      <form className="intent-form" onSubmit={(e) => { e.preventDefault(); void ask(text); }}>
        <span className="intent-glyph" aria-hidden>✦</span>
        <input className="field" value={text} onChange={(e) => setText(e.target.value)} placeholder="Say what you want, for example: protect my 20 NVDAx through earnings" aria-label="What do you want to do" maxLength={300} data-testid="intent-text" />
        <button className="btn primary" type="submit" disabled={busy || !text.trim()} data-testid="intent-go">{busy ? "Reading…" : "Show me the ticket"}</button>
      </form>
      {!result && !error ? (
        <div className="intent-examples">
          {EXAMPLES.map((x) => <button key={x} type="button" className="chip" onClick={() => void ask(x)} disabled={busy}>{x}</button>)}
        </div>
      ) : null}
      {error ? <p className="intent-note down" role="alert" data-testid="intent-error">{error}</p> : null}
      {result ? (
        <div className="intent-result" data-testid="intent-result">
          <div className="intent-ticket">
            <div className="flex items-center gap-3">
              <MarketLogo m={{ symbol: result.market.symbol, logo: result.market.logo }} size={36} />
              <div>
                <div className="flex items-center gap-2" style={{ fontWeight: 500 }}>{buying ? "Buy" : "Write"} a {productName(result.term.side)} on {result.market.symbol} <Badge tone={result.term.side === "call" ? "green" : "blue"}>{productName(result.term.side)} ${usdSmart(result.term.strike)}</Badge></div>
                <div className="small muted">{result.market.name} · mark <span className="mono">${usdSmart(result.market.mark)}</span> · through {dayLabel(result.term.expiryTs)}</div>
              </div>
            </div>
            <div className="intent-figs">
              <div><span>{buying ? "Size" : "You write"}</span><b className="mono">{result.size} {result.market.symbol}</b></div>
              {buying ? <div><span>Total, with fee</span><b className="mono">${usdSmart(result.total)}</b></div> : <div><span>You lock</span><b className="mono">{usdSmart(result.locked!.amount)} {result.locked!.unit}</b></div>}
              {buying ? <div><span>Max loss</span><b className="mono">${usdSmart(result.total)}</b></div> : <div><span>Premium at the ask</span><b className="mono">${usdSmart(result.premium)}</b></div>}
              <div><span>Break-even</span><b className="mono">${usdSmart(result.breakEven)} <span className="small muted">({result.movePct >= 0 ? "+" : "−"}{Math.abs(result.movePct).toFixed(1)}%)</span></b></div>
            </div>
          </div>
          <p className="intent-note" data-testid="intent-explanation">{result.explanation}</p>
          {result.caveats.length ? <ul className="intent-caveats">{result.caveats.map((c) => <li key={c}>{c}</li>)}</ul> : null}
          <div className="flex items-center gap-3 flex-wrap" style={{ marginTop: 12 }}>
            <Link href={result.href} className="btn primary" data-testid="intent-review">Review and {buying ? "buy" : "quote"}</Link>
            <button type="button" className="btn secondary" onClick={() => { setResult(null); setText(""); }}>Ask something else</button>
            <span className="small muted">Nothing is signed until you review the ticket. Contracts can expire worthless; maximum loss on a purchase is the premium plus fees.</span>
          </div>
        </div>
      ) : null}
    </section>
  );
}
