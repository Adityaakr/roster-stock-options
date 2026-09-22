import "server-only";
import { rosterData } from "./roster-data";
import { costOf, breakEven, moveNeeded, productName, type RosterData, type Side, type Term } from "./model";
import { usd, usdSmart, dayLabel } from "./format";

/*
 * The intent box. A sentence like "protect my 20 NVDAx through earnings" becomes a ticket in three steps, and the
 * model is only trusted with the first:
 *   1. parse: the model maps the sentence to a small structured intent (market, side, size or budget, horizon,
 *      strike preference) through a tool call. It never sees the book and never produces a price.
 *   2. resolve: this file picks the term and sizes it with the same `costOf` walk the Act screen uses, so every
 *      figure the person sees is the app's own arithmetic.
 *   3. phrase: the model writes two plain sentences from the resolved facts. Any number in its text that is not one
 *      of the facts fails the check and the deterministic sentence is used instead.
 * The key lives server-side; without one the box is absent from the product, never stubbed.
 */

const OPENROUTER = "https://openrouter.ai/api/v1/chat/completions";
/** Verified against https://openrouter.ai/api/v1/models on 2026-09-20 (supports tools). */
const MODEL = "anthropic/claude-sonnet-5";

export function intentEnabled(): boolean {
  return !!process.env.OPENROUTER_API_KEY;
}

export type IntentAction = "buy_gap" | "buy_floor" | "write_floor" | "write_gap" | "question" | "unclear";
export interface Intent {
  action: IntentAction;
  market: string | null;
  sizeShares: number | null;
  budgetUsdc: number | null;
  /** Value of holdings to cover or of exposure wanted, USD: "$500 of protection" sizes by the price, not the premium. */
  notionalUsdc: number | null;
  horizon: { kind: "nearest" } | { kind: "furthest" } | { kind: "days"; days: number } | { kind: "date"; iso: string };
  strike: "at_the_money" | "cheap" | "tight" | null;
  /** A level relative to the mark in percent, negative below it, when one was stated. */
  strikePct: number | null;
  note: string;
}

export interface Proposal {
  action: Exclude<IntentAction, "unclear">;
  market: { symbol: string; name: string; logo: string | null; mark: number };
  term: { id: string; side: Side; strike: number; expiryTs: number; capacity: number };
  size: number;
  /** Premium, fee and total in USD at `size`; break-even and the move needed in the app's terms. */
  premium: number; fee: number; total: number; breakEven: number; movePct: number;
  /** For the write side: what is locked. */
  locked: { amount: number; unit: string } | null;
  href: string;
  explanation: string;
  /** What the resolver had to decide on its own, in plain words. */
  caveats: string[];
  intent: Intent;
}

export interface IntentFailure { error: string; intent?: Intent }

const TOOL = {
  type: "function",
  function: {
    name: "set_intent",
    description: "Record what the person wants on Roster Finance. Never guess a market: use only symbols from the list. A question about the product, a market, a price or how something works is action question, with the question restated in note. Anything else that is not an Upside, a Floor or writing one is unclear, with why in note.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        action: { type: "string", enum: ["buy_gap", "buy_floor", "write_floor", "write_gap", "question", "unclear"], description: "buy_gap: leveraged upside with loss capped at the premium (a call): 'bet it goes up', 'calls', 'upside'. buy_floor: a funded exit at a chosen price, protection for tokens they hold (a put): 'protect', 'hedge', 'downside', 'exit'. write_floor: get paid to buy lower: 'cash-secured put', 'get paid to buy'. write_gap: get paid to sell higher: 'covered call', 'sell calls on my tokens'. question: they are asking something rather than placing an order." },
        market: { type: ["string", "null"], description: "A symbol from the list, e.g. NVDAx, or null if none fits." },
        size_shares: { type: ["number", "null"], description: "Shares or tokens, when stated. 'my 20 NVDAx' is 20." },
        budget_usdc: { type: ["number", "null"], description: "USD they want to spend on the premium itself, when stated: '$200 of upside', 'spend $50'." },
        notional_usdc: { type: ["number", "null"], description: "USD of holdings to cover or of exposure to take, when stated that way: '$500 of protection', 'protect my $2,000 of SpaceX', '$1,000 worth'. Sized by the price, not the premium. Null when shares or a premium budget were given instead." },
        horizon: { type: "string", enum: ["nearest", "furthest", "days", "date"], description: "How long the contract should last. 'this week', 'the weekend', 'soon' or nothing said are nearest. 'earnings', 'next month', 'as long as possible' are furthest. A number of days or weeks is days (fill horizon_days). A weekday name or a date is date (fill horizon_date with the next such day from today)." },
        horizon_days: { type: ["number", "null"], description: "Only when horizon is days." },
        horizon_date: { type: ["string", "null"], description: "YYYY-MM-DD, only when horizon is date." },
        strike: { type: ["string", "null"], enum: ["at_the_money", "cheap", "tight", null], description: "cheap: the lowest premium. tight: closest to the current price. at_the_money or null: the default." },
        strike_pct_from_mark: { type: ["number", "null"], description: "When a level is stated relative to the price: '10% lower' is -10, '5% higher' is 5. Otherwise null." },
        note: { type: "string", description: "One short sentence: what was assumed, or why it is unclear." }
      },
      required: ["action", "market", "size_shares", "budget_usdc", "notional_usdc", "horizon", "horizon_days", "horizon_date", "strike", "strike_pct_from_mark", "note"]
    }
  }
} as const;

async function chat(body: Record<string, unknown>, timeoutMs = 15_000): Promise<Record<string, unknown>> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is not set");
  // One slow or refused answer is retried once with more patience; a second failure is reported as it is.
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(OPENROUTER, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}`, "HTTP-Referer": "https://roster.finance", "X-Title": "Roster Finance" },
        body: JSON.stringify({ model: MODEL, temperature: 0, ...body }),
        signal: AbortSignal.timeout(attempt === 0 ? timeoutMs : timeoutMs * 2)
      });
      if (res.status >= 500 || res.status === 429) throw new Error(`openrouter: HTTP ${res.status}`);
      if (!res.ok) throw new Error(`openrouter: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
      return (await res.json()) as Record<string, unknown>;
    } catch (e) {
      const msg = (e as Error).message ?? "";
      const transient = /timeout|aborted|HTTP 5\d\d|HTTP 429|fetch failed/i.test(msg);
      if (attempt === 0 && transient) continue;
      throw e;
    }
  }
}

/** Common names for listed underlyings the model or a person may use, beside the symbol and the market's own name. */
const ALIASES: Record<string, string[]> = {
  NVDAx: ["nvidia", "nvda"], TSLAx: ["tesla", "tsla"], SPYx: ["spy", "sp500", "s&p", "s&p 500", "s and p", "the index"], AAPLx: ["apple", "aapl"],
  MSFTx: ["microsoft", "msft"], GOOGLx: ["google", "alphabet", "googl", "goog"], AMZNx: ["amazon", "amzn"], METAx: ["meta", "facebook"],
  OPENAI: ["openai", "open ai", "chatgpt"], SPACEX: ["spacex", "space x"], ANTHROPIC: ["anthropic", "claude"], ANDURIL: ["anduril"],
  NEURALINK: ["neuralink"], KALSHI: ["kalshi"], POLYMARKET: ["polymarket"], FIGUREAI: ["figure ai", "figure", "figureai"]
};

/**
 * A listed market from a name: the symbol, the underlying's ticker, the market's name or a common alias, in that
 * order; case does not matter and a trailing "x" or "xstock" is tolerated. With `scan`, the whole sentence is
 * searched for any of those, longest alias first, so "Nvidia" inside "$200 of Nvidia upside" still resolves.
 */
export function matchMarket(name: string, markets: { symbol: string; name: string; underlyingSymbol: string | null }[], scan = false): string | null {
  const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9&$ ]+/g, " ").replace(/\s+/g, " ").trim();
  const q = norm(name);
  if (!q) return null;
  const bare = q.replace(/\s*x(stock)?$/, "");
  for (const m of markets) {
    const sym = m.symbol.toLowerCase();
    const under = (m.underlyingSymbol ?? "").toLowerCase();
    const mname = norm(m.name);
    const first = mname.replace(/\s+(xstock|prestocks)$/, "");
    if (q === sym || bare === sym.replace(/x$/, "") || (under && (q === under || bare === under)) || q === mname || q === first) return m.symbol;
  }
  const aliasesOf = (m: { symbol: string }) => ALIASES[m.symbol] ?? [];
  if (!scan) {
    for (const m of markets) if (aliasesOf(m).some((a) => a === q || a === bare)) return m.symbol;
    return null;
  }
  // Scan: every candidate string that names a market, longest first so "figure ai" beats "figure" and "space x" beats "spy".
  const candidates: { key: string; symbol: string }[] = [];
  for (const m of markets) {
    candidates.push({ key: m.symbol.toLowerCase(), symbol: m.symbol });
    if (m.underlyingSymbol) candidates.push({ key: m.underlyingSymbol.toLowerCase(), symbol: m.symbol });
    candidates.push({ key: norm(m.name).replace(/\s+(xstock|prestocks)$/, ""), symbol: m.symbol });
    for (const a of aliasesOf(m)) candidates.push({ key: a, symbol: m.symbol });
  }
  candidates.sort((a, b) => b.key.length - a.key.length);
  const padded = ` ${q} `;
  for (const c of candidates) if (c.key.length >= 3 && padded.includes(` ${c.key} `)) return c.symbol;
  return null;
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** The next `weekday` on or after `from` (UTC calendar), plus a week when `next` is set. */
function nextWeekday(from: Date, weekday: number, next: boolean): string {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  let ahead = (weekday - d.getUTCDay() + 7) % 7;
  if (next && ahead === 0) ahead = 7;
  if (next) ahead += 7;
  d.setUTCDate(d.getUTCDate() + ahead);
  return d.toISOString().slice(0, 10);
}

/**
 * A horizon read straight from the sentence: a weekday ("through Friday", "next Friday", "by Wednesday"), "the
 * weekend" (through the coming Monday, the first print after it), or a date ("Oct 2", "2 October", "2026-10-02").
 * Null when the sentence names none, so the model's reading stands.
 */
export function horizonFromText(text: string, today = new Date()): Intent["horizon"] | null {
  const t = text.toLowerCase();
  const iso = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return { kind: "date", iso: iso[0] };
  const wd = t.match(/\b(next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)\b/);
  if (wd) {
    const idx = WEEKDAYS.findIndex((w) => w.startsWith(wd[2]!.slice(0, 3)));
    return { kind: "date", iso: nextWeekday(today, idx, !!wd[1]) };
  }
  if (/\bweekend\b/.test(t)) return { kind: "date", iso: nextWeekday(today, 1, false) };
  const md = t.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})\b/) ?? t.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/);
  if (md) {
    const [a, b] = /^\d/.test(md[1]!) ? [md[2]!, md[1]!] : [md[1]!, md[2]!];
    const month = MONTHS.findIndex((m) => m.startsWith(a.slice(0, 3)));
    const day = Number(b);
    if (month >= 0 && day >= 1 && day <= 31) {
      let year = today.getUTCFullYear();
      const candidate = new Date(Date.UTC(year, month, day));
      if (candidate.getTime() < Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())) year += 1;
      return { kind: "date", iso: new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10) };
    }
  }
  return null;
}

/** Step 1: the sentence to a structured intent. */
export async function parseIntent(text: string, markets: { symbol: string; name: string; underlyingSymbol: string | null }[]): Promise<Intent> {
  const list = markets.map((m) => `${m.symbol}: ${m.name}${m.underlyingSymbol && m.underlyingSymbol !== m.symbol ? ` (${m.underlyingSymbol})` : ""}`).join("\n");
  const system = `You turn a sentence into a trading intent on Roster Finance, a venue for fully paid contracts on tokenized stocks. An Upside is the right to buy at a strike through an expiry (leveraged upside, loss capped at the premium). A Floor is the right to sell at a strike through an expiry (a funded exit). Writing one means getting paid to take the other side. Only these markets exist:\n${list}\nMap company names to their symbol (Nvidia is NVDAx, SpaceX is SPACEX). Call set_intent exactly once. Do not invent a market. A question is action question, never unclear. Today is ${new Date().toISOString().slice(0, 10)}.`;
  const r = await chat({ messages: [{ role: "system", content: system }, { role: "user", content: text }], tools: [TOOL], tool_choice: { type: "function", function: { name: "set_intent" } }, max_tokens: 500 });
  const choice = (r.choices as { message?: { tool_calls?: { function?: { arguments?: string } }[] } }[] | undefined)?.[0];
  const args = choice?.message?.tool_calls?.[0]?.function?.arguments;
  if (!args) throw new Error("the model returned no intent");
  let parsed: unknown;
  try { parsed = JSON.parse(args); } catch { throw new Error(`the model returned malformed arguments: ${args.slice(0, 240)}`); }
  const j = parsed as { action: IntentAction; market: string | null; size_shares: number | null; budget_usdc: number | null; notional_usdc: number | null; horizon: string; horizon_days: number | null; horizon_date: string | null; strike: Intent["strike"]; strike_pct_from_mark: number | null; note: string };
  const modelHorizon: Intent["horizon"] = j.horizon === "days" && j.horizon_days ? { kind: "days", days: Math.max(0, j.horizon_days) } : j.horizon === "date" && j.horizon_date && /^\d{4}-\d{2}-\d{2}$/.test(j.horizon_date) ? { kind: "date", iso: j.horizon_date } : j.horizon === "furthest" ? { kind: "furthest" } : { kind: "nearest" };
  // A weekday or a date in the sentence is the horizon, whatever the model made of it: "through Friday" has to land on
  // Friday, and the model has read it as "this week, so nearest" more than once.
  const horizon = horizonFromText(text) ?? modelHorizon;
  // The model is told to answer with a symbol, but "Nvidia", "NVDA", "nvidia xstock" and "Space X" all arrive in
  // practice; and when it gives nothing, the sentence itself is scanned for a listed name before giving up.
  const symbol = (j.market ? matchMarket(String(j.market), markets) : null) ?? matchMarket(text, markets, true);
  return { action: j.action, market: symbol, sizeShares: j.size_shares && j.size_shares > 0 ? j.size_shares : null, budgetUsdc: j.budget_usdc && j.budget_usdc > 0 ? j.budget_usdc : null, notionalUsdc: j.notional_usdc && j.notional_usdc > 0 ? j.notional_usdc : null, horizon, strike: j.strike ?? null, strikePct: typeof j.strike_pct_from_mark === "number" && Number.isFinite(j.strike_pct_from_mark) ? j.strike_pct_from_mark : null, note: String(j.note ?? "") };
}

/** Step 2: the intent to a term and a size, with the app's own arithmetic. */
export async function resolveIntent(intent: Intent): Promise<Proposal | IntentFailure> {
  if (intent.action === "question") return { error: "question", intent };
  if (intent.action === "unclear") return { error: intent.note || "I could not map that to an Upside, a Floor or writing one.", intent };
  if (!intent.market) return { error: "Which market? Name a listed one, for example NVDAx or TSLAx.", intent };
  const data: RosterData = await rosterData(intent.market);
  const market = data.markets.find((m) => m.symbol === intent.market);
  if (!market || data.underlying.symbol !== intent.market) return { error: `${intent.market} is not listed here.`, intent };
  const side: Side = intent.action === "buy_gap" || intent.action === "write_gap" ? "call" : "put";
  const buying = intent.action.startsWith("buy");
  const caveats: string[] = [];
  const live = data.terms.filter((t) => t.side === side && !t.halted && t.ask > 0 && t.capacity > 0 && t.expiryTs > data.nowTs + 2 * 3600);
  if (!live.length) return { error: `No ${productName(side)} is quoted on ${market.symbol} right now.`, intent };

  // Expiry: the nearest one that lasts as long as asked; if none does, the furthest, and say so.
  const now = data.nowTs;
  const expiries = [...new Set(live.map((t) => t.expiryTs))].sort((a, b) => a - b);
  let expiry: number;
  if (intent.horizon.kind === "furthest") expiry = expiries[expiries.length - 1]!;
  else if (intent.horizon.kind === "nearest") expiry = expiries[0]!;
  else if (intent.horizon.kind === "date") {
    // The expiry on that calendar day if one exists (a Friday expiry prints at 16:00 New York, 20:00 or 21:00 UTC);
    // else the first one after the day begins; else the furthest, said plainly.
    const dayStart = Math.floor(Date.parse(intent.horizon.iso + "T00:00:00Z") / 1000);
    const dayEnd = dayStart + 86_400 + 4 * 3600;
    const sameDay = expiries.find((e) => e >= dayStart && e < dayEnd);
    const after = expiries.find((e) => e >= dayStart);
    if (sameDay !== undefined) expiry = sameDay;
    else if (after !== undefined) { expiry = after; caveats.push(`Nothing expires on ${dayLabel(dayStart + 12 * 3600)}; the next expiry, ${dayLabel(after)}, is used.`); }
    else { expiry = expiries[expiries.length - 1]!; caveats.push(`Nothing runs as long as asked; the furthest expiry, ${dayLabel(expiry)}, is used.`); }
  } else {
    const want = now + intent.horizon.days * 86_400;
    const ok = expiries.filter((e) => e >= want);
    if (ok.length) expiry = ok[0]!;
    else { expiry = expiries[expiries.length - 1]!; caveats.push(`Nothing runs as long as asked; the furthest expiry, ${dayLabel(expiry)}, is used.`); }
  }
  const atExpiry = live.filter((t) => t.expiryTs === expiry);

  // Strike: the default is nearest the mark on the right side of it; cheap is the furthest out; tight is nearest the mark.
  const mark = data.underlying.mark;
  const byDist = [...atExpiry].sort((a, b) => Math.abs(a.strike - mark) - Math.abs(b.strike - mark));
  const outOfMoney = atExpiry.filter((t) => (side === "call" ? t.strike >= mark : t.strike <= mark)).sort((a, b) => Math.abs(a.strike - mark) - Math.abs(b.strike - mark));
  let term: Term;
  if (intent.strikePct !== null) {
    const level = mark * (1 + intent.strikePct / 100);
    term = [...atExpiry].sort((a, b) => Math.abs(a.strike - level) - Math.abs(b.strike - level))[0]!;
    if (Math.abs(term.strike - level) / level > 0.03) caveats.push(`No strike sits at ${intent.strikePct > 0 ? "+" : "−"}${Math.abs(intent.strikePct)}% ($${usdSmart(level)}); the nearest, $${usdSmart(term.strike)}, is used.`);
  }
  else if (intent.strike === "cheap") term = [...atExpiry].sort((a, b) => a.ask - b.ask)[0]!;
  else if (intent.strike === "tight") term = byDist[0]!;
  else term = outOfMoney[0] ?? byDist[0]!;
  if (!outOfMoney.length && intent.strike !== "cheap" && intent.strikePct === null) caveats.push(`Every strike at this expiry is already through the mark; the nearest one, $${usdSmart(term.strike)}, is used.`);

  // Size: what was asked, or what the budget buys at this term's own ladder, never more than is fillable.
  let size: number;
  if (intent.sizeShares) size = intent.sizeShares;
  else if (intent.notionalUsdc && mark > 0) {
    size = Math.max(1, Math.floor(intent.notionalUsdc / mark));
    caveats.push(`$${usdSmart(intent.notionalUsdc)} of ${market.symbol} is ${size} share${size === 1 ? "" : "s"} at the mark of $${usdSmart(mark)}.`);
  }
  else if (intent.budgetUsdc) {
    const one = costOf(term, 1, data.underlying.multiplier, data.feeBps);
    size = one.fillable && one.total > 0 ? Math.max(1, Math.floor(intent.budgetUsdc / one.total)) : 1;
    caveats.push(`$${usdSmart(intent.budgetUsdc)} buys ${size} share${size === 1 ? "" : "s"} at this premium.`);
  } else { size = 10; caveats.push("No size was given; 10 shares is shown."); }
  if (size > term.capacity) { caveats.push(`Only ${Math.floor(term.capacity)} shares are fillable on this term right now; the size is capped there.`); size = Math.max(1, Math.floor(term.capacity)); }
  const c = costOf(term, size, data.underlying.multiplier, data.feeBps);
  if (!c.fillable) return { error: `${size} shares are not fillable on ${market.symbol} ${productName(side)} $${usdSmart(term.strike)} right now.`, intent };
  const askPerShare = c.premium / size;
  const be = breakEven(side, term.strike, askPerShare);
  const proposal: Proposal = {
    action: intent.action,
    market: { symbol: market.symbol, name: market.name, logo: market.logo ?? null, mark },
    term: { id: term.id, side, strike: term.strike, expiryTs: term.expiryTs, capacity: term.capacity },
    size, premium: c.premium, fee: c.fee, total: c.total, breakEven: be, movePct: moveNeeded(side, term.strike, askPerShare, mark),
    locked: buying ? null : side === "put" ? { amount: term.strike * size, unit: "USDC" } : { amount: size, unit: market.symbol },
    href: buying ? `/trade/${term.id}?size=${size}` : `/underwrite?m=${market.symbol}&t=${term.id}&size=${size}`,
    explanation: "", caveats, intent
  };
  proposal.explanation = template(proposal);
  return proposal;
}

/** The sentence the app writes itself; also the fallback when the model's wording fails the number check. */
function template(p: Proposal): string {
  const name = productName(p.term.side);
  const when = dayLabel(p.term.expiryTs);
  if (p.action === "buy_gap") return `Pay $${usdSmart(p.total)} for the right to buy ${p.size} ${p.market.symbol} at $${usdSmart(p.term.strike)} through ${when}. Above $${usdSmart(p.breakEven)} you are ahead; if it never gets there you lose the $${usdSmart(p.total)} and nothing else.`;
  if (p.action === "buy_floor") return `Pay $${usdSmart(p.total)} for the right to sell ${p.size} ${p.market.symbol} at $${usdSmart(p.term.strike)} any time through ${when}, backed by USDC already locked. The most you can lose on the floor is the $${usdSmart(p.total)}.`;
  if (p.action === "write_floor") return `Lock $${usdSmart(p.locked!.amount)} USDC, collect about $${usdSmart(p.premium)} at the current ask, and either keep it at ${when} or buy ${p.size} ${p.market.symbol} at $${usdSmart(p.term.strike)}. Paid risk: if it trades lower you own it at $${usdSmart(p.term.strike)}, and the most you can lose is the $${usdSmart(p.locked!.amount)} less the premium.`;
  return `Lock ${p.size} ${p.market.symbol}, collect about $${usdSmart(p.premium)} at the current ask, and either keep it at ${when} or sell at $${usdSmart(p.term.strike)}. Paid risk: you give up the upside above $${usdSmart(p.term.strike)}. ${name}s are assigned pro rata of what you sold.`;
}

/** Step 3: the model phrases the facts; a number it did not receive is a failed check. */
export async function phrase(p: Proposal): Promise<string> {
  const facts = {
    product: productName(p.term.side), action: p.action, market: p.market.symbol, company: p.market.name, mark: `$${usd(p.market.mark)}`, size: `${p.size}`, strike: `$${usdSmart(p.term.strike)}`, expiry: dayLabel(p.term.expiryTs),
    ...(p.locked ? { premium_received: `$${usdSmart(p.premium)}`, locked: `${usdSmart(p.locked.amount)} ${p.locked.unit}`, effective_price: `$${usdSmart(p.breakEven)}` } : { premium: `$${usdSmart(p.premium)}`, fee: `$${usdSmart(p.fee)}`, total_paid: `$${usdSmart(p.total)}`, max_loss: `$${usdSmart(p.total)}`, break_even: `$${usdSmart(p.breakEven)}`, move_needed_pct: `${p.movePct >= 0 ? "+" : "−"}${Math.abs(p.movePct).toFixed(1)}%` })
  };
  try {
    const system = "You write two short sentences, at most 45 words, in plain English for someone about to buy or write a fully paid contract on a tokenized stock. Use only the numbers given, written exactly as given. Sentence case. No em-dashes. Never say yield, option, call or put; say Upside or Floor. State the benefit and then the worst case: for a purchase the worst case is losing the total paid; for writing a Floor it is owning the shares at the strike with the locked USDC; for writing an Upside it is selling the shares at the strike and giving up anything above it. No advice, no adjectives like great or safe.";
    const r = await chat({ messages: [{ role: "system", content: system }, { role: "user", content: JSON.stringify(facts) }], max_tokens: 120 }, 12_000);
    const text = String((r.choices as { message?: { content?: string } }[] | undefined)?.[0]?.message?.content ?? "").trim().replace(/\s+/g, " ");
    if (!text || text.includes("—") || /\byield\b/i.test(text)) { console.warn(`[intent] phrasing rejected on wording: ${text.slice(0, 160)}`); return p.explanation; }
    const allowed = JSON.stringify(facts);
    const numbers = text.match(/\d[\d,]*(?:\.\d+)?/g) ?? [];
    for (const n of numbers) if (!allowed.includes(n)) { console.warn(`[intent] phrasing rejected on the number ${n}: ${text.slice(0, 160)}`); return p.explanation; }
    return text;
  } catch (e) {
    console.warn(`[intent] phrasing failed: ${(e as Error).message.slice(0, 160)}`);
    return p.explanation;
  }
}

export interface Answer { answer: string; intent: Intent; grounded: boolean }

/** The facts a question is answered from: the product in a few lines and every market's live figures. */
function factSheet(data: RosterData): Record<string, unknown> {
  return {
    product: {
      gap: "An Upside is the right to buy the token at a strike through an expiry: leveraged upside, max loss the premium plus the 10 bps taker fee. A call, fully collateralized, settled in the token.",
      floor: "A Floor is the right to sell the token at a strike any time through an expiry: a funded exit, the USDC locked before it is sold. A put, fully collateralized, no oracle in the way.",
      earn: "Earn is the write side: lock USDC to be paid to buy lower (write a Floor) or lock tokens to be paid to sell higher (write an Upside). Paid risk, never yield; assignment is pro rata of what you sold.",
      vaults: "A Covered Call vault holds tokens and writes Upsides above the mark; a Cash-Secured Put vault holds USDC and writes Floors below it. Depositors receive the premiums the vault collects and carry the assignments: the vault is short volatility with no hedge and will have losing epochs. Its ask rises with utilisation (1 + 3u squared) and it stops at its cap. Epochs are weekly (daily on devnet); deposits enter and withdrawals leave at a roll; every epoch's result is published with its sign.",
      exit: "A holder can exercise, let it expire, or sell back to the vault at its live bid without paying the strike.",
      prestocks: "PreStocks tokens are pre-IPO exposure; they are priced here off where the token trades, never the issuer's mark. The mint's transfer fee (100 bps on mainnet today, read from the mint) is the holder's on both sides and is in the price.",
      fees: "Taker fee 10 bps of the premium at purchase; nothing at exercise or settlement."
    },
    session: data.session,
    markets: data.markets.map((m) => {
      // Every live term on every market, not only the selected one's.
      const terms = data.ideas.filter((t) => t.market === m.symbol && t.ask > 0 && !t.halted);
      const best = (side: Side) => { const xs = terms.filter((t) => t.side === side); return xs.length ? Math.min(...xs.map((t) => t.ask)) : null; };
      const gap = best("call");
      const floor = best("put");
      return {
        symbol: m.symbol, name: m.name, tier: m.tier, mark: `$${usd(m.mark ?? 0)}`, best_ask_gap_per_share: gap === null ? null : `$${usd(gap)}`, best_ask_floor_per_share: floor === null ? null : `$${usd(floor)}`,
        executable_depth: `$${usdSmart(m.depthUsdc)}`, live_series: m.liveSeries, recent_vol: `${Math.round(m.vol * 100)}%`, transfer_fee: m.feeBps ? `${(m.feeBps / 100).toFixed(2)}%` : "none",
        ...(m.wrapperTier === "PreStocks" && m.markSpreadBps !== null ? { issuer_mark: m.issuerMarkPrice !== null ? `$${usd(m.issuerMarkPrice)}` : null, token_vs_mark: `${m.markSpreadBps >= 0 ? "+" : "−"}${(Math.abs(m.markSpreadBps) / 100).toFixed(1)}%` } : {})
      };
    })
  };
}

/** A question answered from the fact sheet only; a number the model did not receive fails the check. */
export async function answerQuestion(question: string, data: RosterData, intent: Intent): Promise<Answer> {
  const facts = factSheet(data);
  const fallback = `I can answer from the live figures only. ${data.markets.length} markets are listed; the cheapest Upside right now is on ${cheapest(data, "call")} and the cheapest Floor on ${cheapest(data, "put")}. Ask for a ticket in a sentence, or open Markets.`;
  try {
    const system = "You answer questions about Roster Finance for someone deciding what to do. Use only the facts given, with every number written exactly as given; if the facts do not cover it, say so in one sentence. At most 70 words, plain English, sentence case, no em-dashes, no bullet points, written once with no self-corrections. Never say yield, option, call or put; say Upside or Floor. No advice on whether to buy; describe what exists and what it costs. End with what they could ask for next, in a few words.";
    const r = await chat({ messages: [{ role: "system", content: system }, { role: "user", content: `Question: ${question}

Facts: ${JSON.stringify(facts)}` }], max_tokens: 200 }, 15_000);
    const text = String((r.choices as { message?: { content?: string } }[] | undefined)?.[0]?.message?.content ?? "").trim().replace(/\s+/g, " ");
    if (!text || text.includes("—") || /\byield\b/i.test(text)) return { answer: fallback, intent, grounded: false };
    const allowed = JSON.stringify(facts);
    for (const n of text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []) if (!allowed.includes(n)) { console.warn(`[intent] answer rejected on the number ${n}: ${text.slice(0, 160)}`); return { answer: fallback, intent, grounded: false }; }
    return { answer: text, intent, grounded: true };
  } catch (e) {
    console.warn(`[intent] answer failed: ${(e as Error).message.slice(0, 160)}`);
    return { answer: fallback, intent, grounded: false };
  }
}
function cheapest(data: RosterData, side: Side): string {
  const xs = data.ideas.filter((t) => t.side === side && t.ask > 0 && !t.halted).sort((a, b) => a.ask - b.ask);
  return xs[0] ? `${xs[0].market} at $${usd(xs[0].ask)} per share` : "no market yet";
}

export async function intentToProposal(text: string): Promise<Proposal | Answer | IntentFailure> {
  const data = await rosterData();
  const intent = await parseIntent(text, data.markets.map((m) => ({ symbol: m.symbol, name: m.name, underlyingSymbol: m.underlyingSymbol })));
  if (intent.action === "question") return answerQuestion(text, data, intent);
  const r = await resolveIntent(intent);
  if ("error" in r) return r;
  r.explanation = await phrase(r);
  return r;
}
