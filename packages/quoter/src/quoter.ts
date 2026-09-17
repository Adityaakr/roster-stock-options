/*
 * The quoter loop for one tier wallet: for every listed market it keeps the grid populated (creating series lazily,
 * addendum C), prices each live series with the model, and refreshes its asks: cancel what is stale, post what is
 * missing, within the per-series and per-wallet caps. Every decision is logged with its inputs. Circuit breakers:
 * Hermes stale or unreachable, basis above threshold, market paused or halted.
 */
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, getAccount, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { RosterClient, type MarketState, type SeriesState } from "@roster/sdk";
import { sessionAt, type Session } from "@roster/core";
import { decideAsk, gridStrikes } from "./model";

export interface MarketQuoteContext {
  market: MarketState;
  symbol: string;
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

  /** One pass over one market. Returns the number of transactions sent. */
  async cycle(ctx: MarketQuoteContext): Promise<number> {
    const m = ctx.market;
    const mk = ctx.symbol;
    const at = ctx.nowTs;
    if (!m.listed || m.paused) {
      this.say({ at, market: mk, action: "breaker", detail: "market not listed or paused" });
      return 0;
    }
    if (ctx.priceAgeSecs > this.cfg.maxPriceAgeSecs) {
      this.say({ at, market: mk, action: "breaker", detail: `price stale ${ctx.priceAgeSecs}s` });
      return 0;
    }
    const session: Session = sessionAt(ctx.nowTs);
    if (session === "regular" && ctx.equityPrice) {
      const basisBps = ((ctx.price - ctx.equityPrice) / ctx.equityPrice) * 10_000;
      if (Math.abs(basisBps) > this.cfg.maxBasisBps) {
        this.say({ at, market: mk, action: "breaker", detail: `basis ${basisBps.toFixed(0)} bps > ${this.cfg.maxBasisBps}` });
        return 0;
      }
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
    const quotable = m.allowedExpiries.filter((e) => e > BigInt(ctx.nowTs)).sort((a, b) => (a < b ? -1 : 1)).slice(0, ctx.tier === 2 ? 1 : undefined);
    for (const expiry of quotable) {
      // Floors are refused by the program on transfer-fee mints until fee-inclusive settlement ships.
      for (const side of (m.hasTransferFee ? ["call"] : ["call", "put"]) as ("call" | "put")[]) {
        for (const strike of gridStrikes(side, forwardPerLot, m.strikeStep).slice(0, this.cfg.strikesPerSide)) {
          if (strike < m.minStrike || strike > m.maxStrike) continue;
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
      }
    }
    // 2. Price and refresh asks on every live series.
    const me = this.client.wallet;
    for (const s of byKey.values()) {
      if (s.expiryTs <= BigInt(ctx.nowTs) || s.halted || !quotable.includes(s.expiryTs)) continue;
      const mySlot = s.writers.find((w) => w.writer.equals(me));
      const sold = mySlot ? Number(mySlot.soldLots6) / 1e6 : 0;
      const d = decideAsk({ side: s.side, price: ctx.price, multiplier: ctx.multiplier, pendingDividendMultiplier: ctx.pendingDividendMultiplier, strikeUsdcPerLot: s.strikeUsdcPerLot, expiryTs: Number(s.expiryTs), nowTs: ctx.nowTs, vol: ctx.vol, session, inActivationWindow: ctx.inActivationWindow, inventoryLots: sold, baseSpread: this.cfg.baseSpread, minAskPerLot: this.cfg.minAskPerLot });
      const myAsks = s.asks.filter((a) => s.writers[a.writerSlot]?.writer.equals(me));
      const current = myAsks[0];
      if (current) {
        const off = Math.abs(Number(current.askPerLot) - Number(d.askPerLot)) / Number(d.askPerLot);
        if (off <= this.cfg.repriceTolerance) {
          this.say({ at, market: mk, series: s.address.toBase58(), action: "keep", detail: `${Number(current.askPerLot) / 1e6} vs model ${Number(d.askPerLot) / 1e6}` });
          continue;
        }
        try {
          for (const a of myAsks) await this.client.send(await this.client.cancelAsk(s, a.seq));
          sent += myAsks.length;
          this.say({ at, market: mk, series: s.address.toBase58(), action: "cancel", detail: `${myAsks.length} asks, off ${(off * 100).toFixed(1)}%` });
        } catch (e) {
          this.say({ at, market: mk, series: s.address.toBase58(), action: "skip", detail: `cancel failed: ${(e as Error).message.slice(0, 120)}` });
          continue;
        }
      }
      // Deposit what is missing to back the ask, then post. On a fee mint only what arrives is credited: ask for
      // what will be free after the fee, floored to the minimum size unit.
      const have = mySlot ? mySlot.depositedLots6 - mySlot.withdrawnLots6 - mySlot.soldLots6 : 0n;
      let want = this.cfg.lotsPerSeries;
      const deposit = have >= want ? 0n : want - have;
      if (ctx.feeBps > 0 && deposit > 0n && s.side === "call") {
        const arrives = (deposit * BigInt(10_000 - ctx.feeBps)) / 10_000n;
        want = ((have + arrives) / 10_000n) * 10_000n - 10_000n;
      }
      if (deposit > 0n && !(await this.canDeposit(m, s, deposit))) {
        this.say({ at, market: mk, series: s.address.toBase58(), action: "skip", detail: "wallet cannot fund the deposit" });
        continue;
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
