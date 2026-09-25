/*
 * The quoter loop for one tier wallet: for every listed market it keeps the grid populated (creating series lazily,
 * addendum C), prices each live series with the model, and refreshes its asks: cancel what is stale, post what is
 * missing, within the per-series and per-wallet caps. Every decision is logged with its inputs. Circuit breakers:
 * Hermes stale or unreachable, basis above threshold, market paused or halted.
 */
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, getAccount, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import type { RosterClient} from "@roster/sdk";
import { type MarketState, type SeriesState } from "@roster/sdk";
import { sessionAt, type Session } from "@roster/core";
import { decideAsk, gridStrikes } from "./model";

export interface MarketQuoteContext {
  market: MarketState;
  symbol: string;
  /** The protocol's grace after expiry, seconds: the next expiry's series are created this far ahead of the nearest one. */
  graceSecs: number;
  /** Liquidity tier (Part 2 section 2): 1 quotes every expiry both sides, 2 the nearest expiry, 3 nothing from the treasury. */
  tier: number;
  /** Transfer fee on the mint, basis points: a deposit credits less than sent, so the ask is sized under it. */
  feeBps: number;
  /** Token feed price per share-equivalent, USD, and its age in seconds. */
  price: number;
  priceAgeSecs: number;
  /** Equity reference when the session is regular, for the basis breaker. */
  equityPrice: number | null;
  multiplier: number;
  pendingDividendMultiplier: number | null;
  inActivationWindow: boolean;
  vol: number;
  nowTs: number;
  /** True when the underlying has no exchange session (pre-IPO): a constant spread replaces the session multiplier. */
  noSession?: boolean | undefined;
}

export interface QuoterConfig {
  lotsPerSeries: bigint;
  baseSpread: number;
  minAskPerLot: bigint;
  maxPriceAgeSecs: number;
  maxBasisBps: number;
  /** Re-price when the current ask is off the model by more than this fraction. */
  repriceTolerance: number;
  strikesPerSide: number;
}

export const DEFAULT_QUOTER: QuoterConfig = { lotsPerSeries: 50n * 1_000_000n, baseSpread: 0.12, minAskPerLot: 50_000n, maxPriceAgeSecs: 60, maxBasisBps: 300, repriceTolerance: 0.05, strikesPerSide: 3 };

export interface QuoterLogLine {
  at: number;
  market: string;
  series?: string;
  action: "skip" | "create_series" | "post" | "cancel" | "keep" | "breaker";
  detail: string;
}

export class Quoter {
  readonly log: QuoterLogLine[] = [];
  constructor(private readonly client: RosterClient, private readonly cfg: QuoterConfig = DEFAULT_QUOTER) {}

  private say(line: QuoterLogLine): void {
    this.log.push(line);
    if (this.log.length > 2_000) this.log.shift();
    console.log(`[quoter] ${line.action} ${line.market}${line.series ? " " + line.series.slice(0, 8) : ""} ${line.detail}`);
  }

  /**
   * One pass over one market. Returns the number of transactions sent. `vaultSides` names the sides a vault quotes on
   * this market (Part 3): the treasury still keeps the grid populated there but posts no asks of its own, so the vault
   * is the book on that side and external writers compete with it, not with the treasury twice over.
   */
  async cycle(ctx: MarketQuoteContext, vaultSides: ReadonlySet<"call" | "put"> = new Set()): Promise<number> {
    const m = ctx.market;
    const mk = ctx.symbol;
    const at = ctx.nowTs;
    // A breaker pulls the treasury's own asks: a resident ask priced on a stale or missing input is the loss.
    if (!m.listed || m.paused) return this.breaker(ctx, "market not listed or paused");
    if (ctx.priceAgeSecs > this.cfg.maxPriceAgeSecs) return this.breaker(ctx, `price stale ${ctx.priceAgeSecs}s`);
    const session: Session = sessionAt(ctx.nowTs);
    if (session === "regular" && ctx.equityPrice) {
      const basisBps = ((ctx.price - ctx.equityPrice) / ctx.equityPrice) * 10_000;
      if (Math.abs(basisBps) > this.cfg.maxBasisBps) return this.breaker(ctx, `basis ${basisBps.toFixed(0)} bps > ${this.cfg.maxBasisBps}`);
    }
    if (ctx.tier >= 3) {
      this.say({ at, market: mk, action: "skip", detail: "tier 3: listed, no treasury quotes" });
      return 0;
    }
    let sent = 0;
    const forwardPerLot = ctx.price * (ctx.pendingDividendMultiplier ?? ctx.multiplier);
    const existing = await this.client.fetchSeriesForMarket(m.address);
    const byKey = new Map(existing.map((s) => [`${s.side}-${s.strikeUsdcPerLot}-${s.expiryTs}`, s]));
    // 1. Keep the grid populated: three strikes a side per allowed expiry, within the live cap.
    let live = m.liveSeries;
    let capSaid = false;
    // The cap is spread so the book never goes dark at an expiry. Series are only created for expiries more than a
    // grace period away (one that expires sooner would hold a slot for nothing), and the slots go by strike rank
    // across the next two such expiries, calls and puts alike: the at-the-money Upside and Floor of both expiries
    // first, then the next strike of each. When the nearer expiry passes, the later one already carries both sides.
    // Further expiries take what is left. Tier 2 quotes two expiries rather than one for the same reason.
    const strikesBySide = (["call", "put"] as ("call" | "put")[]).map((side) => ({ side, strikes: gridStrikes(side, forwardPerLot, m.strikeStep).slice(0, this.cfg.strikesPerSide).filter((k) => k >= m.minStrike && k <= m.maxStrike) }));
    const { quotable, pairs } = gridPlan(m.allowedExpiries, BigInt(ctx.nowTs), BigInt(ctx.graceSecs), ctx.tier, strikesBySide);
    for (const { side, strike, expiry } of pairs) {
      const key = `${side}-${strike}-${expiry}`;
      if (byKey.has(key)) continue;
      if (live >= m.maxLiveSeries) {
        if (!capSaid) this.say({ at, market: mk, action: "skip", detail: `live series cap ${m.maxLiveSeries} reached; grid strikes wait for a series to close` });
        capSaid = true;
        continue;
      }
      try {
        const { tx, series } = await this.client.createSeries(m, side, strike, expiry);
        await this.client.send(tx);
        const s = await this.client.fetchSeries(series);
        if (s) byKey.set(key, s);
        live += 1;
        sent += 1;
        this.say({ at, market: mk, series: series.toBase58(), action: "create_series", detail: `${side} ${Number(strike) / 1e6} exp ${expiry}` });
      } catch (e) {
        this.say({ at, market: mk, action: "skip", detail: `create_series failed: ${(e as Error).message.slice(0, 120)}` });
      }
    }
    // 2. Price and refresh asks on every live series.
    const me = this.client.wallet;
    for (const s of byKey.values()) {
      if (s.expiryTs <= BigInt(ctx.nowTs) || s.halted || !quotable.includes(s.expiryTs)) continue;
      const mySlot = s.writers.find((w) => w.writer.equals(me));
      if (vaultSides.has(s.side)) {
        // The vault writes this side. Any ask the treasury still has here is pulled once and not replaced.
        for (const a of s.asks.filter((a) => s.writers[a.writerSlot]?.writer.equals(me))) {
          try { await this.client.send(await this.client.cancelAsk(s, a.seq)); sent += 1; this.say({ at, market: mk, series: s.address.toBase58(), action: "cancel", detail: "the vault quotes this side" }); } catch { /* next tick */ }
        }
        continue;
      }
      const sold = mySlot ? Number(mySlot.soldLots6) / 1e6 : 0;
      const d = decideAsk({ side: s.side, price: ctx.price, multiplier: ctx.multiplier, pendingDividendMultiplier: ctx.pendingDividendMultiplier, strikeUsdcPerLot: s.strikeUsdcPerLot, expiryTs: Number(s.expiryTs), nowTs: ctx.nowTs, vol: ctx.vol, session, inActivationWindow: ctx.inActivationWindow, inventoryLots: sold, baseSpread: this.cfg.baseSpread, minAskPerLot: this.cfg.minAskPerLot, transferFeeBps: ctx.feeBps, noSession: ctx.noSession });
      const myAsks = s.asks.filter((a) => s.writers[a.writerSlot]?.writer.equals(me));
      const current = myAsks[0];
      if (current) {
        const off = Math.abs(Number(current.askPerLot) - Number(d.askPerLot)) / Number(d.askPerLot);
        // A premium of a few cents swings by a large fraction on every tick of the mark; repricing it each time is
        // churn the RPC pays for and no buyer notices. Under a dollar a lot the tolerance is a fifth, not a twentieth.
        const tolerance = Number(d.askPerLot) < 1_000_000 ? Math.max(this.cfg.repriceTolerance, 0.2) : this.cfg.repriceTolerance;
        // A resident ask at the right price is kept while at least half its target size is still on the book; once
        // fills have eaten more than that, or the configured size has grown, it is reposted at full size.
        const remaining = myAsks.reduce((a, x) => a + x.remainingLots6, 0n);
        if (off <= tolerance && remaining * 2n >= this.cfg.lotsPerSeries) {
          this.say({ at, market: mk, series: s.address.toBase58(), action: "keep", detail: `${Number(current.askPerLot) / 1e6} vs model ${Number(d.askPerLot) / 1e6} · ${Number(remaining) / 1e6} of ${Number(this.cfg.lotsPerSeries) / 1e6} lots resident` });
          continue;
        }
      }
      // What the wallet can back is settled before anything is cancelled, so a cancel is never left without a repost.
      // On a fee mint only what arrives is credited: ask for what will be free after the fee, floored to the unit.
      const have = mySlot ? mySlot.depositedLots6 - mySlot.withdrawnLots6 - mySlot.soldLots6 : 0n;
      let want = this.cfg.lotsPerSeries;
      let deposit = have >= want ? 0n : want - have;
      if (deposit > 0n && !(await this.canDeposit(m, s, deposit))) {
        // Quote what is already in the slot rather than nothing.
        deposit = 0n;
        want = (have / 10_000n) * 10_000n;
        if (want < m.minLots6) {
          this.say({ at, market: mk, series: s.address.toBase58(), action: "skip", detail: "wallet cannot fund the deposit and the slot holds less than a minimum ask" });
          continue;
        }
      }
      if (ctx.feeBps > 0 && deposit > 0n && s.side === "call") {
        const arrives = (deposit * BigInt(10_000 - ctx.feeBps)) / 10_000n;
        want = ((have + arrives) / 10_000n) * 10_000n - 10_000n;
      }
      if (current) {
        try {
          for (const a of myAsks) await this.client.send(await this.client.cancelAsk(s, a.seq));
          sent += myAsks.length;
          this.say({ at, market: mk, series: s.address.toBase58(), action: "cancel", detail: `${myAsks.length} asks, off ${((Math.abs(Number(current.askPerLot) - Number(d.askPerLot)) / Number(d.askPerLot)) * 100).toFixed(1)}%` });
        } catch (e) {
          this.say({ at, market: mk, series: s.address.toBase58(), action: "skip", detail: `cancel failed: ${(e as Error).message.slice(0, 120)}` });
          continue;
        }
      }
      try {
        await this.client.send(await this.client.quote(m, s, deposit, want, d.askPerLot));
        sent += 1;
        this.say({ at, market: mk, series: s.address.toBase58(), action: "post", detail: `${Number(want) / 1e6} lots @ ${Number(d.askPerLot) / 1e6} · ${d.reason}` });
      } catch (e) {
        this.say({ at, market: mk, series: s.address.toBase58(), action: "skip", detail: `quote failed: ${(e as Error).message.slice(0, 160)}` });
      }
    }
    return sent;
  }

  /** Pull every ask of ours on the market and log why. */
  async pullQuotes(m: MarketState, symbol: string, nowTs: number, why: string): Promise<number> {
    const me = this.client.wallet;
    let n = 0;
    for (const s of await this.client.fetchSeriesForMarket(m.address)) {
      if (s.expiryTs <= BigInt(nowTs)) continue;
      for (const a of s.asks.filter((a) => s.writers[a.writerSlot]?.writer.equals(me))) {
        try {
          await this.client.send(await this.client.cancelAsk(s, a.seq));
          n += 1;
        } catch (e) {
          this.say({ at: nowTs, market: symbol, series: s.address.toBase58(), action: "skip", detail: `pull failed: ${(e as Error).message.slice(0, 100)}` });
        }
      }
    }
    if (n) this.say({ at: nowTs, market: symbol, action: "cancel", detail: `${n} asks pulled: ${why}` });
    return n;
  }

  private async breaker(ctx: MarketQuoteContext, why: string): Promise<number> {
    this.say({ at: ctx.nowTs, market: ctx.symbol, action: "breaker", detail: why });
    return this.pullQuotes(ctx.market, ctx.symbol, ctx.nowTs, why);
  }

  private async canDeposit(m: MarketState, s: SeriesState, lots6: bigint): Promise<boolean> {
    const conn = this.client.provider.connection;
    try {
      if (s.side === "call") {
        const ata = getAssociatedTokenAddressSync(m.mint, this.client.wallet, false, m.tokenProgram);
        const bal = (await getAccount(conn, ata, "confirmed", m.tokenProgram)).amount;
        return bal >= lots6 * 10n ** BigInt(m.decimals - 6);
      }
      const ata = getAssociatedTokenAddressSync(m.quoteMint, this.client.wallet, false, TOKEN_PROGRAM_ID);
      const bal = (await getAccount(conn, ata, "confirmed", TOKEN_PROGRAM_ID)).amount;
      return bal >= (lots6 * s.strikeUsdcPerLot + 999_999n) / 1_000_000n;
    } catch {
      return false;
    }
  }
}

export { TOKEN_2022_PROGRAM_ID, PublicKey };

/**
 * Which series to create, in order, and which expiries to keep quoting. Pure, so the allocation is tested without a
 * chain. Expiries within `grace` of now are quoted (their series exist) but never created; creation goes by strike
 * rank across the next two creatable expiries, both sides, then further expiries. Tier 2 quotes two expiries.
 */
export function gridPlan(
  allowed: bigint[],
  now: bigint,
  grace: bigint,
  tier: number,
  strikesBySide: { side: "call" | "put"; strikes: bigint[] }[]
): { quotable: bigint[]; pairs: { side: "call" | "put"; strike: bigint; expiry: bigint }[] } {
  const ahead = allowed.filter((e) => e > now).sort((a, b) => (a < b ? -1 : 1));
  const creatable = ahead.filter((e) => e - now > grace);
  const quotable = tier === 2 ? ahead.slice(0, ahead.length - creatable.length + 2) : ahead;
  const rows: { side: "call" | "put"; strike: bigint; expiry: bigint; rank: number; band: number }[] = [];
  creatable.filter((e) => quotable.includes(e)).forEach((expiry, i) => {
    for (const { side, strikes } of strikesBySide) strikes.forEach((strike, rank) => rows.push({ side, strike, expiry, rank, band: i < 2 ? 0 : 1 }));
  });
  rows.sort((a, b) => a.band - b.band || a.rank - b.rank || (a.expiry < b.expiry ? -1 : a.expiry > b.expiry ? 1 : 0) || (a.side === b.side ? 0 : a.side === "call" ? -1 : 1));
  return { quotable, pairs: rows.map(({ side, strike, expiry }) => ({ side, strike, expiry })) };
}
