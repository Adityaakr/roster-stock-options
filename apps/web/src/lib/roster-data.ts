import "server-only";
import { DEFAULT_SIZE, lots6ForShares, nextFridays, sessionAt, termId, walkAsks, type ExerciseEvent, type Market, type Position, type RosterData, type Session, type Side, type Term, type Tier, type Underlying, type Underwriter } from "./model";
import { services, servicesReachable, type ServicesMarket, type ServicesRoster, type ServicesSeries } from "./services";

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
  const writers = s.writers.map((w, slot) => ({ account: w.writer, live: !w.settled && asks.some((a) => a.writerSlot === slot), askLots: Number(asks.filter((a) => a.writerSlot === slot).reduce((a, x) => a + x.remainingLots6, 0n)) / 1e6 }));
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
    capacity: (Number(capacityLots6) / 1e6) * mult,
    openInterest: (Number(openLots6) / 1e6) * mult,
    strikePerLot: s.strike_usdc_per_lot,
    bestAskPerLot: best ? best.askPerLot.toString() : null,
    asks: s.asks.map((a) => ({ askPerLot: a.ask_per_lot, remainingLots6: a.remaining_lots6, writerSlot: a.writer_slot, seq: a.seq })),
    slots: s.writers.map((w, slot) => ({ slot, account: w.writer, deposited: (Number(w.deposited_lots6) / 1e6) * mult, withdrawn: (Number(w.withdrawn_lots6) / 1e6) * mult, sold: (Number(w.sold_lots6) / 1e6) * mult, open: (Number(w.open_lots6) / 1e6) * mult, assigned: (Number(w.assigned_lots6) / 1e6) * mult, premiumClaimable: Number(w.premium_claimable) / 1e6, settled: w.settled })),
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
    wrapperTier: "xStock",
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
    depthUsdc,
    bestAsk: asks.length ? Math.min(...asks) : null
  };
}

function underlyingOf(m: Market): Underlying {
  return { symbol: m.symbol, name: m.name, mint: m.mint, mark: m.mark ?? 0, equityMark: m.equityMark, basisBps: m.basisBps, multiplier: m.multiplier, pendingActivationTs: m.pendingActivationTs, wrapperTier: m.wrapperTier };
}

function underwritersOf(terms: Term[], treasury: string | null): Underwriter[] {
  const by = new Map<string, Underwriter>();
  for (const t of terms) {
    for (const w of t.writers) {
      const u = by.get(w.account) ?? { name: w.account === treasury ? "Roster treasury" : `Underwriter ${w.account.slice(0, 4)}…${w.account.slice(-4)}`, kind: w.account === treasury ? "treasury" : "external", account: w.account, usdcReserved: 0, underlyingReserved: 0, live: false };
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

async function fromServices(r: ServicesRoster, selected: string | undefined): Promise<RosterData> {
  const nowTs = r.nowTs;
  const termsByMarket = r.markets.map((m) => ({ m, terms: m.series.map((s) => liveTerm(m, s)) }));
  const markets = termsByMarket.map(({ m, terms }) => liveMarket(m, nowTs, terms)).sort((a, b) => b.depthUsdc - a.depthUsdc || a.tier - b.tier);
  const terms = termsByMarket.flatMap((x) => x.terms).filter((t) => t.expiryTs > nowTs);
  const pick = markets.find((m) => m.symbol.toLowerCase() === selected?.toLowerCase()) ?? markets[0];
  const mine = pick ? terms.filter((t) => t.market === pick.symbol) : [];
  const cluster = r.cluster === "fork" ? "fork" : r.cluster === "devnet" ? "devnet" : "mainnet";
  const label = cluster === "fork" ? "Mainnet fork" : cluster === "devnet" ? "Devnet" : "Mainnet";
  const treasury = process.env.NEXT_PUBLIC_TREASURY ?? null;
  const exercises = pick ? await liveExercises(mine).catch(() => []) : [];
  return {
    cluster,
    clusterLabel: label,
    programDeployed: r.programDeployed,
    blocked: r.blocked,
    nowTs,
    session: r.session as Session,
    markets,
    underlying: pick ? underlyingOf(pick) : { symbol: "NVDAx", name: "Nvidia xStock", mint: null, mark: 0, equityMark: null, basisBps: null, multiplier: 1, pendingActivationTs: null, wrapperTier: "xStock" },
    expiries: pick ? pick.expiries : [],
    terms: mine,
    underwriters: underwritersOf(mine, treasury),
    positions: [],
    exercises,
    feeBps: r.feeBps ?? 0,
    keeperFeeUsd: r.keeperFeeUsdc ? Number(r.keeperFeeUsdc) / 1e6 : 0,
    source: `${label}. Program ${r.program}. Marks from ${pick?.priceSource === "hermes" ? "Pyth Hermes" : pick?.priceSource === "reference" ? "a fork-only reference price" : "no feed"}; asks, reserves and positions read from the program's accounts by the indexer.${r.blocked ? ` The quoter is blocked on ${r.blocked}.` : ""}`
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
    hasTransferFee: false, hasPermanentDelegate: true, pausable: true, mark: FIXTURE_MARK, priceSource: "fixture", equityMark: equityOpen ? 182.08 : null,
    basisBps: equityOpen ? 12 : null, multiplier: 1, pendingActivationTs: null, inActivationWindow: false, vol: 0.35, volSource: "fixture", expiries,
    liveSeries: terms.length, maxLiveSeries: 12, depthUsdc: terms.reduce((a, t) => a + t.capacity * t.strike, 0), bestAsk: 0.6
  };
  return {
    cluster: "fixture",
    clusterLabel: "Fixture",
    programDeployed: false,
    blocked: "services",
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

export async function rosterData(selected?: string): Promise<RosterData> {
  if (await servicesReachable()) {
    try {
      return await fromServices(await services.roster(), selected);
    } catch (e) {
      console.warn(`[web] services roster failed, on the fixture cluster: ${(e as Error).message}`);
    }
  }
  return fixture();
}

/** A wallet's positions across every market, with premium paid and exercised counts from its own events. */
export async function walletPositions(wallet: string): Promise<{ positions: Position[]; source: string }> {
  if (!(await servicesReachable())) return { positions: [], source: "fixture" };
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
    const held = (Number(x.lots6) / 1e6) * mult;
    const ex = (exercised.get(x.series) ?? 0) * mult;
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
  return { positions: positions.sort((a, b) => a.expiryTs - b.expiryTs), source: "indexer" };
}

export { DEFAULT_SIZE };
