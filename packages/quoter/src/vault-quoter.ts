/*
 * The vault's leg of the quoter (Part 3). For each vault on a market it prices every series the vault may write, the
 * ones on its side that expire before its next roll, and keeps two things current on chain: the vault's ask (through
 * `vault_quote`, the same book path as any writer) and the vault's bid (a `VaultBid` the holder's `sell_to_vault`
 * reads). Every decision is logged with its inputs. The breakers that stop the treasury's own asks stop the vault's
 * too; the book and every exercise never notice.
 */
import type { RosterClient, MarketState, SeriesState, VaultState, VaultKind } from "@roster/sdk";
import { sessionAt } from "@roster/core";
import { decideVaultQuote } from "./model";
import type { MarketQuoteContext, QuoterConfig, QuoterLogLine } from "./quoter";

export interface VaultQuoterConfig {
  /** Half-spread of the bid below theoretical at the regular session. */
  bidSpread: number;
  /** How long a posted bid stands before the holder's instruction refuses it; refreshed every tick. */
  bidTtlSecs: bigint;
  /** Lots the vault asks per series at once; the per-series cap on the vault account is the ceiling. */
  lotsPerSeries: bigint;
}

export const DEFAULT_VAULT_QUOTER: VaultQuoterConfig = { bidSpread: 0.08, bidTtlSecs: 900n, lotsPerSeries: 20n * 1_000_000n };

export class VaultQuoter {
  readonly log: QuoterLogLine[] = [];
  constructor(private readonly client: RosterClient, private readonly cfg: QuoterConfig, private readonly vcfg: VaultQuoterConfig = DEFAULT_VAULT_QUOTER) {}

  private say(line: QuoterLogLine): void {
    this.log.push(line);
    if (this.log.length > 2_000) this.log.shift();
    console.log(`[vault] ${line.action} ${line.market}${line.series ? " " + line.series.slice(0, 8) : ""} ${line.detail}`);
  }

  /** One pass for one vault. Returns transactions sent. */
  async cycle(ctx: MarketQuoteContext, v: VaultState, series: SeriesState[]): Promise<number> {
    const m = ctx.market;
    const mk = `${ctx.symbol}/${v.kind === "covered_call" ? "cc" : "csp"}`;
    const at = ctx.nowTs;
    if (v.halted) {
      this.say({ at, market: mk, action: "breaker", detail: "vault halted" });
      return this.pull(ctx, v, series);
    }
    if (v.totalShares === 0n) {
      this.say({ at, market: mk, action: "skip", detail: `no shares yet: ${v.pendingDepositRaw} raw queued, first roll at ${v.nextRollTs}` });
      return 0;
    }
    const side = v.kind === "covered_call" ? "call" : "put";
    const session = sessionAt(at);
    let sent = 0;
    // What the vault may spend on deposits right now: its balance less what is queued or reserved for others.
    const spendable = await this.spendable(m, v);
    const eligible = series.filter((s) => s.side === side && !s.halted && s.expiryTs > BigInt(at) && s.expiryTs <= v.nextRollTs);
    if (!eligible.length) {
      this.say({ at, market: mk, action: "skip", detail: `no ${side} series expiring by the next roll (${v.nextRollTs}); ${series.filter((s) => s.side === side && s.expiryTs > BigInt(at)).length} live on the other side of it` });
      return 0;
    }
    for (const s of eligible) {
      if (s.side !== side || s.halted || s.expiryTs <= BigInt(at) || s.expiryTs > v.nextRollTs) continue;
      const slot = s.writers.find((w) => w.writer.equals(v.address));
      const sold = slot ? Number(slot.soldLots6) / 1e6 : 0;
      const capLots = Number(v.capPerSeriesLots6) / 1e6;
      const d = decideVaultQuote({ side, price: ctx.price, multiplier: ctx.multiplier, pendingDividendMultiplier: ctx.pendingDividendMultiplier, strikeUsdcPerLot: s.strikeUsdcPerLot, expiryTs: Number(s.expiryTs), nowTs: at, vol: ctx.vol, session, inActivationWindow: ctx.inActivationWindow, baseSpread: this.cfg.baseSpread, minAskPerLot: this.cfg.minAskPerLot, soldLots: sold, capLots, bidSpread: this.vcfg.bidSpread });
      const key = s.address.toBase58();

      // The bid stands whenever the vault is short here: size is exactly its unassigned short.
      const open = slot ? slot.openLots6 : 0n;
      if (open > 0n && d.bidPerLot > 0n) {
        try {
          await this.client.send(await this.client.vaultPostBid(m, v.kind, s, d.bidPerLot, open, this.vcfg.bidTtlSecs));
          sent += 1;
          this.say({ at, market: mk, series: key, action: "post", detail: `bid ${Number(d.bidPerLot) / 1e6} for up to ${Number(open) / 1e6} lots` });
        } catch (e) {
          this.say({ at, market: mk, series: key, action: "skip", detail: `bid failed: ${(e as Error).message.slice(0, 120)}` });
        }
      }

      // The ask.
      const myAsks = s.asks.filter((a) => s.writers[a.writerSlot]?.writer.equals(v.address));
      if (d.atCapacity) {
        this.say({ at, market: mk, series: key, action: "skip", detail: `vault at capacity: ${sold} of ${capLots} lots sold` });
        for (const a of myAsks) {
          try { await this.client.send(await this.client.vaultCancelAsk(m, v.kind, s, a.seq)); sent += 1; } catch { /* the next tick tries again */ }
        }
        continue;
      }
      const current = myAsks[0];
      if (current) {
        const off = Math.abs(Number(current.askPerLot) - Number(d.askPerLot)) / Number(d.askPerLot);
        if (off <= this.cfg.repriceTolerance) {
          this.say({ at, market: mk, series: key, action: "keep", detail: `${Number(current.askPerLot) / 1e6} vs model ${Number(d.askPerLot) / 1e6}` });
          continue;
        }
      }
      const have = slot ? slot.depositedLots6 - slot.withdrawnLots6 - slot.soldLots6 : 0n;
      const room = v.capPerSeriesLots6 - (slot ? slot.depositedLots6 - slot.withdrawnLots6 : 0n);
      let want = this.vcfg.lotsPerSeries < room + have ? this.vcfg.lotsPerSeries : room + have;
      let deposit = have >= want ? 0n : want - have;
      const unit = side === "call" ? BigInt(10 ** m.decimals) / 1_000_000n : s.strikeUsdcPerLot / 1_000_000n;
      if (deposit > 0n && deposit * unit > spendable.raw) {
        deposit = (spendable.raw / unit / 10_000n) * 10_000n;
        want = have + deposit;
      }
      if (want < m.minLots6) {
        this.say({ at, market: mk, series: key, action: "skip", detail: `nothing free to write: ${Number(have) / 1e6} lots in the slot, ${spendable.raw} raw spendable` });
        continue;
      }
      if (ctx.feeBps > 0 && deposit > 0n && side === "call") {
        const arrives = (deposit * BigInt(10_000 - ctx.feeBps)) / 10_000n;
        want = ((have + arrives) / 10_000n) * 10_000n - 10_000n;
      }
      if (current) {
        try {
          for (const a of myAsks) await this.client.send(await this.client.vaultCancelAsk(m, v.kind, s, a.seq));
          sent += myAsks.length;
        } catch (e) {
          this.say({ at, market: mk, series: key, action: "skip", detail: `cancel failed: ${(e as Error).message.slice(0, 120)}` });
          continue;
        }
      }
      try {
        await this.client.send(await this.client.vaultQuote(m, v.kind, s, deposit, want, d.askPerLot));
        sent += 1;
        spendable.raw -= deposit * unit;
        this.say({ at, market: mk, series: key, action: "post", detail: `${Number(want) / 1e6} lots @ ${Number(d.askPerLot) / 1e6} · ${d.reason}` });
      } catch (e) {
        this.say({ at, market: mk, series: key, action: "skip", detail: `vault_quote failed: ${(e as Error).message.slice(0, 160)}` });
      }
    }
    return sent;
  }

  /** Pull the vault's asks on every live series of the market. Bids expire on their own TTL. */
  async pull(ctx: MarketQuoteContext, v: VaultState, series: SeriesState[]): Promise<number> {
    let n = 0;
    for (const s of series) {
      if (s.expiryTs <= BigInt(ctx.nowTs)) continue;
      for (const a of s.asks.filter((a) => s.writers[a.writerSlot]?.writer.equals(v.address))) {
        try {
          await this.client.send(await this.client.vaultCancelAsk(ctx.market, v.kind, s, a.seq));
          n += 1;
        } catch { /* the next tick tries again */ }
      }
    }
    return n;
  }

  private async spendable(m: MarketState, v: VaultState): Promise<{ raw: bigint }> {
    const conn = this.client.provider.connection;
    const info = await conn.getAccountInfo(v.collateralAta, "confirmed");
    const amount = info ? info.data.readBigUInt64LE(64) : 0n;
    const raw = amount - v.reservedCollateralRaw - v.pendingDepositRaw;
    void m;
    return { raw: raw > 0n ? raw : 0n };
  }
}

export type { VaultKind };
