import "server-only";
import { DEFAULT_SIZE, lots6ForShares, nextFridays, sharesOf, sessionAt, termId, walkAsks, type ExerciseEvent, type Market, type Position, type Receipt, type RosterData, type Session, type Side, type Term, type Tier, type Underlying, type Underwriter } from "./model";
import { services, servicesReachable, type ServicesMarket, type ServicesRoster, type ServicesSeries } from "./services";
import { freshSeries } from "./tx-server";
import { readRegistry } from "@roster/registry";

const LOGOS = new Map((readRegistry()?.entries ?? []).map((e) => [e.mint, e.logo]));

/*
 * The data the app renders, assembled server-side from the services process (indexer, oracle, quoter). When the
 * services do not answer the app is on the `fixture` cluster: every figure is a test fixture and the UI says so in
 * the cluster badge and under every instrument. Expiries and the session always come from the real clock.
 */

const LADDER_SIZES = [10, 50, 200];


const FIXTURE_MARK = 182.3;

/* ---------- live: services -> model ---------- */

function toTier(t: number): Tier {
  return t === 2 ? 2 : t === 3 ? 3 : 1;
}

function liveTerm(m: ServicesMarket, s: ServicesSeries): Term {
  const mult = m.multiplier || 1;
  const strike = Number(s.strike_usdc_per_lot) / 1e6 / mult;
  const asks = s.asks.map((a) => ({ askPerLot: BigInt(a.ask_per_lot), remainingLots6: BigInt(a.remaining_lots6), writerSlot: a.writer_slot }));
  const best = asks.length ? asks.reduce((a, b) => (b.askPerLot < a.askPerLot ? b : a)) : null;
  const ladder = LADDER_SIZES.map((size) => {
    const w = walkAsks(asks, lots6ForShares(size, mult));
    return { size, ask: w.fillable ? Number(w.premium) / 1e6 / size : null, underwriters: w.writers };
  });
  const capacityLots6 = asks.reduce((a, x) => a + x.remainingLots6, 0n);
  const openLots6 = BigInt(s.total_sold_lots6) - BigInt(s.total_exercised_lots6);
  const writers = s.writers.map((w, slot) => ({ account: w.writer, live: !w.settled && asks.some((a) => a.writerSlot === slot), askLots: sharesOf(asks.filter((a) => a.writerSlot === slot).reduce((a, x) => a + x.remainingLots6, 0n), mult) }));
  return {
    id: termId(m.symbol, s.side, Number(s.strike_usdc_per_lot) / 1e6, s.expiry_ts),
    market: m.symbol,
    series: s.address,
    positionMint: s.position_mint,
    side: s.side,
    strike,
    expiryTs: s.expiry_ts,
    ask: best ? Number(best.askPerLot) / 1e6 / mult : 0,
    ladder,
    capacity: sharesOf(capacityLots6, mult),
    openInterest: sharesOf(openLots6, mult),
    strikePerLot: s.strike_usdc_per_lot,
    bestAskPerLot: best ? best.askPerLot.toString() : null,
    asks: s.asks.map((a) => ({ askPerLot: a.ask_per_lot, remainingLots6: a.remaining_lots6, writerSlot: a.writer_slot, seq: a.seq })),
    slots: s.writers.map((w, slot) => ({ slot, account: w.writer, deposited: sharesOf(w.deposited_lots6, mult), withdrawn: sharesOf(w.withdrawn_lots6 ?? "0", mult), sold: sharesOf(w.sold_lots6, mult), open: sharesOf(w.open_lots6, mult), assigned: sharesOf(w.assigned_lots6, mult), premiumClaimable: Number(w.premium_claimable) / 1e6, settled: w.settled })),
    escrow: { collateralVault: s.collateral_vault, settlementVault: s.settlement_vault, quoteVault: s.quote_vault, collateralBalance: s.collateral_balance, settlementBalance: s.settlement_balance },
    writers,
    halted: s.halted !== 0
  };
}

function liveMarket(m: ServicesMarket, nowTs: number, terms: Term[]): Market {
  const live = terms.filter((t) => t.expiryTs > nowTs);
  const depthUsdc = live.reduce((a, t) => a + (t.side === "call" ? t.capacity * (t.strike || 0) : t.capacity * t.strike), 0);
  const asks = live.filter((t) => t.ask > 0).map((t) => t.ask);
  return {
    symbol: m.symbol,
    name: m.name,
    mint: m.mint,
    address: m.market,
    decimals: m.decimals,
    tier: toTier(m.tier),
    listed: m.listed,
    paused: m.paused,
    wrapperTier: m.wrapper ?? "xStock",
    feeBps: m.feeBps ?? 0,
    hasTransferFee: m.hasTransferFee,
    hasPermanentDelegate: m.hasPermanentDelegate,
    pausable: m.pausable,
    mark: m.price,
    priceSource: m.priceSource,
    equityMark: m.equityPrice,
    basisBps: m.basisBps === null ? null : Math.round(m.basisBps),
    multiplier: m.multiplier || 1,
    pendingActivationTs: m.pendingActivationTs,
    inActivationWindow: m.inActivationWindow,
    vol: m.vol,
    volSource: m.volSource,
    expiries: m.allowedExpiries.map(Number).filter((e) => e > nowTs).sort((a, b) => a - b),
    liveSeries: m.liveSeries,
    maxLiveSeries: m.maxLiveSeries,
    minLots6: m.minLots6,
    depthUsdc,
    bestAsk: asks.length ? Math.min(...asks) : null,
    logo: LOGOS.get(m.mint) ?? null,
    sparkline: m.sparkline ?? [],
    changePct: m.sparkline && m.sparkline.length >= 2 && m.sparkline[0]![1] > 0 ? ((m.sparkline[m.sparkline.length - 1]![1] - m.sparkline[0]![1]) / m.sparkline[0]![1]) * 100 : null
  };
}

function underlyingOf(m: Market): Underlying {
  return { symbol: m.symbol, name: m.name, mint: m.mint, mark: m.mark ?? 0, equityMark: m.equityMark, basisBps: m.basisBps, multiplier: m.multiplier, pendingActivationTs: m.pendingActivationTs, wrapperTier: m.wrapperTier };
}

function underwritersOf(terms: Term[], treasury: string | null, quoter: string | null): Underwriter[] {
  const by = new Map<string, Underwriter>();
  for (const t of terms) {
    for (const w of t.writers) {
      const kind: Underwriter["kind"] = w.account === treasury ? "treasury" : w.account === quoter ? "maker" : "external";
      const u = by.get(w.account) ?? { name: kind === "treasury" ? "Roster treasury" : kind === "maker" ? "Roster quoter" : `${w.account.slice(0, 4)}…${w.account.slice(-4)}`, kind, account: w.account, usdcReserved: 0, underlyingReserved: 0, live: false };
      if (t.side === "put") u.usdcReserved += w.askLots * t.strike * 1; else u.underlyingReserved += w.askLots;
      u.live = u.live || w.live;
      by.set(w.account, u);
    }
  }
  return [...by.values()].sort((a, b) => b.usdcReserved + b.underlyingReserved - (a.usdcReserved + a.underlyingReserved));
}

async function liveExercises(terms: Term[]): Promise<ExerciseEvent[]> {
  const bySeries = new Map(terms.map((t) => [t.series, t]));
  const [ex, failed] = await Promise.all([services.events({ name: "Exercised", limit: 50 }), services.events({ name: "Failed", limit: 50 })]);
  const out: ExerciseEvent[] = [];
  for (const e of ex) {
    const d = JSON.parse(e.data_json) as { series: string; lots6: string; usdc: string; raw: string; auto: boolean };
    const t = bySeries.get(d.series);
    if (!t) continue;
    const shares = Number(d.lots6) / 1e6;
    out.push({ ts: e.block_time, termId: t.id, shares, kind: d.auto ? "auto_exercise" : "exercise", ok: true, signature: e.signature, note: t.side === "call" ? `paid ${(Number(d.usdc) / 1e6).toFixed(2)} USDC, received ${shares} ${t.market}` : `delivered ${shares} ${t.market}, received ${(Number(d.usdc) / 1e6).toFixed(2)} USDC` });
  }
  for (const e of failed) {
    const d = JSON.parse(e.data_json) as { err: unknown; logs: string[] };
    const line = d.logs.find((l) => l.includes("Error Message:")) ?? "";
    if (!/exercise/i.test(d.logs.join(" "))) continue;
    out.push({ ts: e.block_time, termId: "", shares: 0, kind: "auto_exercise", ok: false, signature: e.signature, note: line.replace(/.*Error Message: /, "declined: ") || "declined" });
  }
  return out.sort((a, b) => b.ts - a.ts).slice(0, 40);
}

async function fromServices(r: ServicesRoster, selected: string | undefined, fresh: boolean): Promise<RosterData> {
  const nowTs = r.nowTs;
  let termsByMarket = r.markets.map((m) => ({ m, terms: m.series.map((s) => liveTerm(m, s)) }));
  let markets = termsByMarket.map(({ m, terms }) => liveMarket(m, nowTs, terms)).sort((a, b) => b.depthUsdc - a.depthUsdc || a.tier - b.tier);
  const pick = markets.find((m) => m.symbol.toLowerCase() === selected?.toLowerCase()) ?? markets[0];
  if (fresh && pick) {
    // Right after a transaction the indexer's snapshot can be a tick behind; read the chosen market's series from chain.
    const m = r.markets.find((x) => x.symbol === pick.symbol);
    if (m) {
      m.series = await freshSeries(m.market, m.series).catch(() => m.series);
      termsByMarket = r.markets.map((x) => ({ m: x, terms: x.series.map((s) => liveTerm(x, s)) }));
      markets = termsByMarket.map(({ m: x, terms }) => liveMarket(x, nowTs, terms)).sort((a, b) => b.depthUsdc - a.depthUsdc || a.tier - b.tier);
    }
  }
  const terms = termsByMarket.flatMap((x) => x.terms).filter((t) => t.expiryTs > nowTs);
  const mine = pick ? terms.filter((t) => t.market === pick.symbol) : [];
  // History covers the market's expired series too: an exercise on a term that has since expired still happened.
  const allOfMarket = pick ? termsByMarket.find((x) => x.m.symbol === pick.symbol)?.terms ?? [] : [];
  const cluster = r.cluster === "fork" ? "fork" : r.cluster === "devnet" ? "devnet" : "mainnet";
  const label = cluster === "fork" ? "Mainnet fork" : cluster === "devnet" ? "Devnet" : "Mainnet";
  const exercises = pick ? await liveExercises(allOfMarket).catch(() => []) : [];
  return {
    cluster,
    clusterLabel: label,
    programDeployed: r.programDeployed,
    blocked: r.blocked,
    autoExerciseLive: false,
    nowTs,
    session: r.session as Session,
    markets,
    underlying: pick ? underlyingOf(pick) : { symbol: "NVDAx", name: "Nvidia xStock", mint: null, mark: 0, equityMark: null, basisBps: null, multiplier: 1, pendingActivationTs: null, wrapperTier: "xStock" },
    expiries: pick ? pick.expiries : [],
    terms: mine,
    underwriters: underwritersOf(mine, r.treasury, r.quoter),
    positions: [],
    exercises,
    feeBps: r.feeBps ?? 0,
    keeperFeeUsd: r.keeperFeeUsdc ? Number(r.keeperFeeUsdc) / 1e6 : 0,
    source: `${label}. Program ${r.program}. Marks from ${pick?.priceSource === "hermes" ? "Pyth Hermes" : pick?.priceSource === "reference" ? "a fork-only reference price" : pick?.priceSource === "xstocks" ? "the xStocks API quote (no Pyth key; display only off the fork)" : pick?.priceSource === "tessera" ? "Tessera's published mark (no Pyth feed exists)" : pick?.priceSource === "prestocks" ? "the PreStocks token price (no Pyth feed exists)" : "no feed"}; asks, reserves and positions read from the program's accounts by the indexer.${r.blocked ? ` The quoter is blocked on ${r.blocked}.` : ""}`
  };
}

/* ---------- fixture ---------- */

/** Premium per share by side, strike and expiry rank (0 = nearest Friday). Chosen so the worked examples in CLAUDE.md 6 hold. */
const PREMIUM: Record<Side, Record<number, [number, number]>> = {
  call: { 180: [5.4, 8.1], 185: [2.9, 5.6], 190: [1.45, 3.7] },
  put: { 180: [3.0, 5.3], 175: [1.35, 3.2], 170: [0.6, 1.85] }
};

function fixtureTerms(expiries: number[]): Term[] {
  const out: Term[] = [];
  expiries.forEach((exp, rank) => {
    for (const side of ["call", "put"] as const) {
      for (const [k, prem] of Object.entries(PREMIUM[side])) {
        const strike = Number(k);
        const ask = prem[rank === 0 ? 0 : 1];
        const step = Math.max(0.05, Math.round(ask * 0.04 * 100) / 100);
        out.push({
          id: termId("NVDAx", side, strike, exp),
          market: "NVDAx",
          series: null,
          positionMint: null,
          side,
          strike,
          expiryTs: exp,
          ask,
          ladder: [
            { size: 10, ask, underwriters: 1 },
            { size: 50, ask: Math.round((ask + step) * 100) / 100, underwriters: 2 },
            { size: 200, ask: Math.round((ask + step * 3) * 100) / 100, underwriters: 3 }
          ],
          capacity: side === "call" ? 260 : 320,
          openInterest: rank === 0 ? (strike === 180 ? 140 : 40) : 20,
          strikePerLot: String(strike * 1e6),
          bestAskPerLot: String(Math.round(ask * 1e6)),
          asks: [{ askPerLot: String(Math.round(ask * 1e6)), remainingLots6: String((side === "call" ? 260 : 320) * 1e6), writerSlot: 0, seq: "0" }],
          escrow: null,
          writers: [],
          slots: [],
          halted: false
        });
      }
    }
  });
  return out;
}

const UNDERWRITERS: Underwriter[] = [
  { name: "Roster treasury", kind: "treasury", account: null, usdcReserved: 118_800, underlyingReserved: 420, live: true },
  { name: "Maker bot", kind: "maker", account: null, usdcReserved: 54_000, underlyingReserved: 180, live: true },
  { name: "External underwriter", kind: "external", account: null, usdcReserved: 0, underlyingReserved: 0, live: false }
];

function fixturePositions(expiries: number[]): Position[] {
  const near = expiries[0] ?? 0;
  const far = expiries[1] ?? near;
  return [
    { id: "pos-1", termId: termId("NVDAx", "call", 180, near), market: "NVDAx", series: null, side: "call", strike: 180, expiryTs: near, shares: 10, premiumPaid: 54, exercised: 0, signature: null, autoExercise: false, expired: false },
    { id: "pos-2", termId: termId("NVDAx", "put", 180, far), market: "NVDAx", series: null, side: "put", strike: 180, expiryTs: far, shares: 20, premiumPaid: 106, exercised: 0, signature: null, autoExercise: true, expired: false }
  ];
}

function fixtureExercises(now: number, expiries: number[]): ExerciseEvent[] {
  const near = expiries[0] ?? now;
  return [
    { ts: now - 2 * 86_400, termId: termId("NVDAx", "call", 180, near), shares: 5, kind: "exercise", ok: true, signature: null, note: "paid 900.00 USDC, received 5 NVDAx" },
    { ts: now - 86_400, termId: termId("NVDAx", "put", 175, near), shares: 10, kind: "auto_exercise", ok: false, signature: null, note: "declined: out of the money by more than the keeper fee" }
  ];
}

function fixture(): RosterData {
  const now = Math.floor(Date.now() / 1000);
  const expiries = nextFridays(now, 2);
  const session = sessionAt(now);
  const equityOpen = session === "regular";
  const terms = fixtureTerms(expiries);
  const market: Market = {
    symbol: "NVDAx", name: "Nvidia xStock", mint: null, address: null, decimals: 8, tier: 1, listed: true, paused: false, wrapperTier: "xStock",
    feeBps: 0, hasTransferFee: false, hasPermanentDelegate: true, pausable: true, mark: FIXTURE_MARK, priceSource: "fixture", equityMark: equityOpen ? 182.08 : null,
    basisBps: equityOpen ? 12 : null, multiplier: 1, pendingActivationTs: null, inActivationWindow: false, vol: 0.35, volSource: "fixture", expiries,
    liveSeries: terms.length, maxLiveSeries: 12, minLots6: "10000", depthUsdc: terms.reduce((a, t) => a + t.capacity * t.strike, 0), bestAsk: 0.6, logo: null, sparkline: [], changePct: null
  };
  return {
    cluster: "fixture",
    clusterLabel: "Fixture",
    programDeployed: false,
    blocked: "services",
    autoExerciseLive: false,
    nowTs: now,
    session,
    markets: [market],
    underlying: underlyingOf(market),
    expiries,
    terms,
    underwriters: UNDERWRITERS,
    positions: fixturePositions(expiries),
    exercises: fixtureExercises(now, expiries),
    feeBps: 10,
    keeperFeeUsd: 2,
    source: "Fixture cluster: the services process is not reachable. Premiums, marks, reserves and positions are test fixtures; expiries and the session badge follow the clock. Mint, feed ids and escrow accounts are never invented."
  };
}

/* ---------- entry points ---------- */

export async function rosterData(selected?: string, fresh = false): Promise<RosterData> {
  if (await servicesReachable()) {
    try {
      return await fromServices(await services.roster(), selected, fresh);
    } catch (e) {
      console.warn(`[web] services roster failed, on the fixture cluster: ${(e as Error).message}`);
    }
  }
  return fixture();
}

/** A wallet's positions across every market, with premium paid and exercised counts from its own events. */
export async function walletPositions(wallet: string): Promise<{ positions: Position[]; history: Receipt[]; source: string }> {
  if (!(await servicesReachable())) return { positions: [], history: [], source: "fixture" };
  const [r, p] = await Promise.all([services.roster(), services.positions(wallet)]);
  const markets = new Map(r.markets.map((m) => [m.market, m]));
  const bought = new Map<string, { premium: number; signature: string | null }>();
  const exercised = new Map<string, number>();
  for (const e of p.events) {
    const d = JSON.parse(e.data_json) as Record<string, string>;
    if (e.name === "Bought" && d.buyer === wallet) {
      const prev = bought.get(d.series!) ?? { premium: 0, signature: null };
      bought.set(d.series!, { premium: prev.premium + Number(d.premium_paid ?? d.premiumPaid ?? 0) / 1e6, signature: prev.signature ?? e.signature });
    }
    if (e.name === "Exercised" && d.holder === wallet) exercised.set(d.series!, (exercised.get(d.series!) ?? 0) + Number(d.lots6) / 1e6);
  }
  const positions: Position[] = [];
  for (const x of p.positions) {
    const m = markets.get(x.market);
    if (!m) continue;
    const mult = m.multiplier || 1;
    const strike = Number(x.strike_usdc_per_lot) / 1e6 / mult;
    const held = sharesOf(x.lots6, mult);
    const ex = Math.round((exercised.get(x.series) ?? 0) * mult * 1e4) / 1e4;
    positions.push({
      id: x.series,
      termId: termId(m.symbol, x.side, Number(x.strike_usdc_per_lot) / 1e6, x.expiry_ts),
      market: m.symbol,
      series: x.series,
      side: x.side,
      strike,
      expiryTs: x.expiry_ts,
      shares: held + ex,
      premiumPaid: bought.get(x.series)?.premium ?? 0,
      exercised: ex,
      signature: bought.get(x.series)?.signature ?? null,
      autoExercise: x.autoExercise,
      expired: x.expiry_ts <= r.nowTs
    });
  }
  return { positions: positions.sort((a, b) => a.expiryTs - b.expiryTs), history: receipts(wallet, p.events, r), source: "indexer" };
}

/** Every event that names the wallet, as a receipt line. Names and fields are the program's own (programs/roster_finance/src/events.rs). */
function receipts(wallet: string, events: { signature: string; block_time: number; name: string; data_json: string }[], r: ServicesRoster): Receipt[] {
  const series = new Map<string, { m: ServicesMarket; s: ServicesSeries }>();
  for (const m of r.markets) for (const s of m.series) series.set(s.address, { m, s });
  const out: Receipt[] = [];
  const shares = (lots6: string, mult: number) => sharesOf(lots6, mult);
  const usdcOf = (micro: string) => (Number(micro) / 1e6).toFixed(2);
  for (const e of events) {
    const d = JSON.parse(e.data_json) as Record<string, string>;
    const hit = d.series ? series.get(d.series) : undefined;
    // A closed series is gone from the indexer's live view; keep the line with what the event itself says.
    const sym = hit?.m.symbol ?? "";
    const mult = hit?.m.multiplier || 1;
    const id = hit ? termId(hit.m.symbol, hit.s.side, Number(hit.s.strike_usdc_per_lot) / 1e6, hit.s.expiry_ts) : "";
    const line = (kind: Receipt["kind"], note: string) => out.push({ ts: e.block_time, kind, market: sym, termId: id, note, signature: e.signature });
    if (e.name === "Bought" && d.buyer === wallet) line("buy", `bought ${shares(d.lots6Filled ?? "0", mult)} ${sym} for ${usdcOf(d.premiumPaid ?? "0")} USDC plus ${usdcOf(d.fee ?? "0")} fee${Number(d.lots6Filled) < Number(d.lots6Requested) ? ` (partial: ${shares(d.lots6Requested ?? "0", mult)} requested)` : ""}`);
    if (e.name === "Exercised" && d.holder === wallet) line(d.auto === "true" || (d.auto as unknown) === true ? "auto_exercise" : "exercise", hit?.s.side === "put" ? `delivered ${shares(d.lots6 ?? "0", mult)} ${sym}, received ${usdcOf(d.usdc ?? "0")} USDC` : `paid ${usdcOf(d.usdc ?? "0")} USDC, received ${shares(d.lots6 ?? "0", mult)} ${sym}`);
    if (e.name === "AskPosted" && d.writer === wallet) line("quote", `quoted ${shares(d.lots6 ?? "0", mult)} ${sym} at ${usdcOf(d.askPerLot ?? "0")} USDC per lot`);
    if (e.name === "PremiumClaimed" && d.writer === wallet) line("claim", `claimed ${usdcOf(d.amount ?? "0")} USDC premium`);
    if (e.name === "CollateralWithdrawn" && d.writer === wallet) line("withdraw", `withdrew ${shares(d.lots6 ?? "0", mult)} ${sym} of unsold collateral`);
    if (e.name === "WriterSettled" && d.writer === wallet) line("release", `released: ${shares(d.unassignedLots6 ?? "0", mult)} ${sym} not assigned, ${shares(d.assignedLots6 ?? "0", mult)} assigned; ${usdcOf(d.settlementOut ?? "0")} USDC settlement, ${usdcOf(d.premiumOut ?? "0")} USDC premium`);
  }
  return out.sort((a, b) => b.ts - a.ts);
}

export { DEFAULT_SIZE };
