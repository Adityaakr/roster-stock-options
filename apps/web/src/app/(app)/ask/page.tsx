"use client";

import Link from "next/link";
import { useState } from "react";
import { MarketLogo } from "@/components/market-list";
import { PayoffChart } from "@/components/payoff-chart";
import { Badge } from "@/components/ui";
import { usd, usdSmart, dayLabel } from "@/lib/format";
import { productName, type Side } from "@/lib/model";
import { useIntentEnabled, type Proposal } from "@/lib/use-intent";

/*
 * Ask: say what you want, review the ticket, sign somewhere else. The page shows the ticket the app priced, what the
 * model read from the sentence and every decision the resolver made on its own, so a person can see exactly how a
 * sentence became a term and a size. The model parses and phrases; the app computes (docs/INTENT.md).
 */
const EXAMPLES: { group: string; what: string; items: string[] }[] = [
  { group: "Upside", what: "a Gap: leveraged upside, loss capped at the premium", items: ["$200 of Nvidia upside through Friday", "50 TSLAx of upside for two weeks, the cheap strike", "SPYx upside through the weekend"] },
  { group: "Protection", what: "a Floor: a funded exit at a price you choose", items: ["protect my 20 NVDAx through earnings", "a floor under 10 SPYx 5% below the price", "sell my tKalshi at a known price next week"] },
  { group: "Get paid", what: "write one: paid risk, disclosed as such", items: ["get paid to buy Tesla 10% lower", "sell the upside on my 25 GOOGLx above $360", "write a floor on NVDAx for the week"] }
];

export default function AskPage() {
  const enabled = useIntentEnabled();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Proposal | null>(null);
  const [error, setError] = useState<{ error: string; intent?: Proposal["intent"] } | null>(null);
  const [recent, setRecent] = useState<string[]>([]);

  async function ask(q: string) {
    const t = q.trim();
    if (!t || busy) return;
    setText(t);
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await fetch("/api/intent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: t }) });
      const j = (await r.json()) as Proposal | { error: string; intent?: Proposal["intent"] };
      if ("error" in j) setError(j);
      else setResult(j);
      setRecent((xs) => [t, ...xs.filter((x) => x !== t)].slice(0, 5));
    } catch (e) {
      setError({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  if (enabled === false) {
    return (
      <div>
        <div className="page-head"><div><h1>Ask</h1><p>This deployment has no model key, so there is nothing to ask here. The markets, terms and tickets are one click away.</p></div></div>
        <Link href="/markets" className="btn primary">Markets</Link>
      </div>
    );
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Ask</h1>
          <p>Say what you want in a sentence. The model reads it, the app picks the term and prices it with the same walk the ticket uses, and you review before anything is signed.</p>
        </div>
      </div>

      <form className="ask-form card" onSubmit={(e) => { e.preventDefault(); void ask(text); }} data-testid="intent">
        <span className="glyph" aria-hidden>✦</span>
        <input className="field" value={text} onChange={(e) => setText(e.target.value)} placeholder="protect my 20 NVDAx through earnings" aria-label="What do you want to do" maxLength={300} autoFocus data-testid="intent-text" />
        <button className="btn primary" type="submit" disabled={busy || !text.trim() || enabled === null} data-testid="intent-go">{busy ? "Reading…" : "Show me the ticket"}</button>
      </form>

      {busy ? <div className="ask-busy card" aria-live="polite"><span className="dot" /><span>Reading the sentence, then walking the book…</span></div> : null}
      {error ? (
        <div className="card pad ask-error" role="alert" data-testid="intent-error">
          <div className="h6">Could not turn that into a ticket</div>
          <p className="body-sm" style={{ margin: "6px 0 0" }}>{error.error}</p>
          {error.intent ? <IntentRead intent={error.intent} /> : null}
        </div>
      ) : null}

      {result ? <Result p={result} onReset={() => { setResult(null); setText(""); }} /> : null}

      {!result && !busy ? (
        <>
          <div className="ask-examples">
            {EXAMPLES.map((g) => (
              <div key={g.group} className="card ask-group">
                <div className="h6">{g.group}</div>
                <div className="small muted" style={{ marginTop: 2 }}>{g.what}</div>
                <div className="ask-items">{g.items.map((x) => <button key={x} type="button" className="ask-item" onClick={() => void ask(x)}>{x}<span aria-hidden>→</span></button>)}</div>
              </div>
            ))}
          </div>
          {recent.length ? <div className="small muted" style={{ marginTop: 12 }}>Recent: {recent.map((r, i) => <span key={r}>{i ? " · " : ""}<button className="link" type="button" onClick={() => void ask(r)}>{r}</button></span>)}</div> : null}
        </>
      ) : null}

      <div className="grid-3 ask-how">
        <div className="card pad"><div className="h6">1. The model reads</div><p className="body-sm">It maps the sentence to a market from the listed names, a side, a size or a budget, a horizon and a strike preference, and says what it assumed. It never sees a price.</p></div>
        <div className="card pad"><div className="h6">2. The app computes</div><p className="body-sm">The expiry, the strike and the size are chosen by rules you can read in <code>docs/INTENT.md</code>, and the premium is the walk of the resident asks on that term, the same figure the ticket shows.</p></div>
        <div className="card pad"><div className="h6">3. The model phrases</div><p className="body-sm">Two sentences from the resolved facts. A number that is not one of those facts, an em-dash or the word yield throws the wording out for the app&apos;s own sentence.</p></div>
      </div>
      <p className="note" style={{ marginTop: 12 }}>This is not advice. Contracts can expire worthless; maximum loss on a purchase is the premium plus fees; writing is paid risk. Nothing is signed on this page.</p>
    </div>
  );
}

function Result({ p, onReset }: { p: Proposal; onReset: () => void }) {
  const buying = p.action.startsWith("buy");
  const side: Side = p.term.side;
  const name = productName(side);
  // The chart pins the max loss at the total paid, fee included, so it matches the figure above it.
  const askPerShare = p.total / p.size;
  // What the ticket is worth at expiry for the person asking: the buyer's payoff, or the writer's, net of the premium.
  const pnl = (price: number) => {
    const intrinsic = (side === "call" ? Math.max(0, price - p.term.strike) : Math.max(0, p.term.strike - price)) * p.size;
    return buying ? intrinsic - p.total : p.premium - intrinsic;
  };
  const scen = [-0.2, -0.1, 0, 0.1, 0.2].map((d) => ({ d, price: p.market.mark * (1 + d), v: pnl(p.market.mark * (1 + d)) }));
  const expected = side === "call" ? p.term.strike * 1.08 : p.term.strike * 0.92;
  return (
    <div className="ask-result" data-testid="intent-result">
      <div className="card">
        <div className="ask-ticket-head">
          <div className="flex items-center gap-3">
            <MarketLogo m={{ symbol: p.market.symbol, logo: p.market.logo }} size={40} />
            <div>
              <div className="flex items-center gap-2 h5" style={{ margin: 0 }}>{buying ? "Buy" : "Write"} a {name} on {p.market.symbol} <Badge tone={side === "call" ? "green" : "blue"}>{name} ${usdSmart(p.term.strike)}</Badge></div>
              <div className="small muted">{p.market.name} · mark <span className="mono">${usd(p.market.mark)}</span> · through {dayLabel(p.term.expiryTs)}</div>
            </div>
          </div>
          <Link href={p.href} className="btn primary" data-testid="intent-review">Review and {buying ? "buy" : "quote"}</Link>
        </div>
        <div className="intent-figs" style={{ padding: "0 20px" }}>
          <div><span>{buying ? "Size" : "You write"}</span><b className="mono">{p.size} {p.market.symbol}</b></div>
          {buying ? <div><span>Total, with fee</span><b className="mono">${usdSmart(p.total)}</b></div> : <div><span>You lock</span><b className="mono">{usdSmart(p.locked!.amount)} {p.locked!.unit}</b></div>}
          {buying ? <div><span>Max loss</span><b className="mono">${usdSmart(p.total)}</b></div> : <div><span>Premium at the ask</span><b className="mono">${usdSmart(p.premium)}</b></div>}
          <div><span>{buying ? "Break-even" : "Effective price"}</span><b className="mono">${usdSmart(p.breakEven)}</b><i className="small muted">{p.movePct >= 0 ? "+" : "−"}{Math.abs(p.movePct).toFixed(1)}% from the mark</i></div>
        </div>
        <p className="intent-note" style={{ padding: "0 20px" }} data-testid="intent-explanation">{p.explanation}</p>
        {buying ? <div style={{ padding: "8px 20px 0" }}><PayoffChart side={side} strike={p.term.strike} premium={askPerShare} shares={p.size} mark={p.market.mark} expected={expected} height={220} /></div> : null}
        <table className="table" style={{ marginTop: 12 }}>
          <thead><tr><th>{p.market.symbol} at expiry</th><th className="num">Your result</th><th>Which means</th></tr></thead>
          <tbody>
            {scen.map((r) => (
              <tr key={r.d}>
                <td><span className="mono">${usd(r.price)}</span> <span className="small muted">({r.d === 0 ? "the mark" : `${r.d > 0 ? "+" : "−"}${Math.abs(r.d * 100).toFixed(0)}%`})</span></td>
                <td className={`num mono ${r.v < 0 ? "down" : r.v > 0 ? "up" : ""}`}>{r.v === 0 ? "0" : `${r.v > 0 ? "+" : "−"}$${usdSmart(Math.abs(r.v))}`}</td>
                <td className="small muted">{meaning(p, r.price)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex items-center gap-3 flex-wrap" style={{ padding: "14px 20px 18px" }}>
          <Link href={p.href} className="btn primary">Review and {buying ? "buy" : "quote"}</Link>
          <button type="button" className="btn secondary" onClick={onReset}>Ask something else</button>
          <span className="small muted">Nothing is signed here. The ticket opens with this term and size filled in.</span>
        </div>
      </div>

      <div className="ask-side">
        <IntentRead intent={p.intent} />
        <div className="card pad">
          <div className="h6">What the app decided</div>
          <div className="ask-rows">
            <div><span>Expiry</span><b>{dayLabel(p.term.expiryTs)}</b></div>
            <div><span>Strike</span><b className="mono">${usdSmart(p.term.strike)} <span className="small muted">({p.term.strike >= p.market.mark ? "+" : "−"}{(Math.abs(p.term.strike - p.market.mark) / p.market.mark * 100).toFixed(1)}% from the mark)</span></b></div>
            <div><span>Size</span><b className="mono">{p.size} {p.market.symbol}</b></div>
            <div><span>Price</span><b>the resident asks on this term, walked cheapest first{buying ? `, plus the taker fee of $${usdSmart(p.fee)}` : ""}</b></div>
            <div><span>Fillable now</span><b className="mono">{Math.floor(p.term.capacity)} {p.market.symbol}</b></div>
          </div>
          {p.caveats.length ? <><div className="h6" style={{ marginTop: 14 }}>On its own</div><ul className="intent-caveats" style={{ marginTop: 6 }}>{p.caveats.map((c) => <li key={c}>{c}</li>)}</ul></> : <p className="small muted" style={{ margin: "10px 0 0" }}>Nothing had to be assumed beyond the defaults above.</p>}
        </div>
      </div>
    </div>
  );
}

/** What the model read from the sentence, shown as it was returned, so a wrong reading is visible before the ticket is. */
function IntentRead({ intent }: { intent: Proposal["intent"] }) {
  const h = intent.horizon;
  const horizon = h.kind === "nearest" ? "the nearest expiry" : h.kind === "furthest" ? "the furthest expiry" : h.kind === "days" ? `${h.days} days` : `by ${h.iso}`;
  const action = { buy_gap: "buy a Gap", buy_floor: "buy a Floor", write_floor: "write a Floor", write_gap: "write a Gap", unclear: "unclear" }[intent.action];
  return (
    <div className="card pad">
      <div className="h6">What the model read</div>
      <div className="ask-rows">
        <div><span>Action</span><b>{action}</b></div>
        <div><span>Market</span><b>{intent.market ?? <span className="muted">none named</span>}</b></div>
        <div><span>Size</span><b>{intent.sizeShares ? `${intent.sizeShares} shares` : intent.budgetUsdc ? `a $${usdSmart(intent.budgetUsdc)} budget` : <span className="muted">not stated</span>}</b></div>
        <div><span>Horizon</span><b>{horizon}</b></div>
        <div><span>Strike</span><b>{intent.strikePct !== null ? `${intent.strikePct > 0 ? "+" : "−"}${Math.abs(intent.strikePct)}% from the price` : intent.strike === "cheap" ? "the cheapest" : intent.strike === "tight" ? "the tightest" : "the default, nearest the price"}</b></div>
        {intent.note ? <div><span>Its note</span><b className="muted" style={{ fontWeight: 400 }}>{intent.note}</b></div> : null}
      </div>
    </div>
  );
}

function meaning(p: Proposal, price: number): string {
  const above = price > p.term.strike;
  const sym = p.market.symbol;
  if (p.action === "buy_gap") return above ? `buy ${p.size} ${sym} at $${usdSmart(p.term.strike)}, worth $${usdSmart(price)}` : "expires unused; the premium is the whole loss";
  if (p.action === "buy_floor") return above ? "expires unused; the premium is the whole loss" : `sell ${p.size} ${sym} at $${usdSmart(p.term.strike)} while it trades at $${usdSmart(price)}`;
  if (p.action === "write_floor") return above ? "keep the premium; the USDC is released" : `buy ${p.size} ${sym} at $${usdSmart(p.term.strike)} while it trades at $${usdSmart(price)}`;
  return above ? `sell ${p.size} ${sym} at $${usdSmart(p.term.strike)} while it trades at $${usdSmart(price)}` : "keep the premium; the tokens are released";
}
