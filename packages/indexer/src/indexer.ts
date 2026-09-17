/*
 * The indexer: snapshots every market and series of the program into the store, walks the program's signatures for
 * events (idempotent on (signature, instruction index), resumable from the last stored signature), and computes the
 * executable-protection view the roster page reads (fillable size at three notionals, reserves with vault
 * addresses, exercise history including failures). The app never scans the chain directly.
 */
import * as anchorNs from "@anchor-lang/core";
import type { Connection} from "@solana/web3.js";
import { PublicKey, type ConfirmedSignatureInfo } from "@solana/web3.js";
import { getAccount } from "@solana/spl-token";
import BN from "bn.js";
import type { RosterClient} from "@roster/sdk";
import { type MarketState, type SeriesState } from "@roster/sdk";
import type { Store, SeriesRow, MarketRow } from "./store";

const anchor = ((anchorNs as { default?: unknown }).default ?? anchorNs) as typeof anchorNs;

export interface MarketMeta {
  mint: string;
  symbol: string;
  name: string;
}

export interface Fillable {
  size_lots6: string;
  /** Average premium per lot in micro-USDC to fill that size, or null when the book cannot fill it. */
  avg_ask_per_lot: string | null;
  cost_usdc: string | null;
  asks_walked: number;
}

export interface Protection {
  series: string;
  market: string;
  side: string;
  strike_usdc_per_lot: string;
  expiry_ts: number;
  fillable: Fillable[];
  reserved: { collateral_vault: string; collateral_balance: string; settlement_vault: string; settlement_balance: string; quote_vault: string };
  capacity_lots6: string;
  open_lots6: string;
  writers_live: number;
  history: { signature: string; block_time: number; name: string; data: unknown }[];
}

const STANDARD_SIZES = [10n, 50n, 200n].map((n) => n * 1_000_000n);

/** Walk the sorted ask list as `buy` would (eight asks, cheapest first) for a requested size. */
export function fillableAt(s: SeriesState, size: bigint): Fillable {
  let remaining = size;
  let cost = 0n;
  let walked = 0;
  for (const a of s.asks) {
    if (remaining === 0n || walked === 8) break;
    const take = a.remainingLots6 < remaining ? a.remainingLots6 : remaining;
    cost += (take * a.askPerLot) / 1_000_000n;
    remaining -= take;
    walked += 1;
  }
  if (remaining > 0n) return { size_lots6: size.toString(), avg_ask_per_lot: null, cost_usdc: null, asks_walked: walked };
  return { size_lots6: size.toString(), avg_ask_per_lot: ((cost * 1_000_000n) / size).toString(), cost_usdc: cost.toString(), asks_walked: walked };
}

/** Event data as decimal strings and base58 keys. `JSON.stringify` would call `BN.toJSON`, which is hex. */
function plain(v: unknown): unknown {
  if (typeof v === "bigint") return v.toString();
  if (BN.isBN(v)) return v.toString(10);
  if (v instanceof PublicKey) return v.toBase58();
  if (Array.isArray(v)) return v.map(plain);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, plain(x)]));
  return v;
}

export class Indexer {
  private parser: InstanceType<typeof anchor.EventParser>;
  constructor(private readonly connection: Connection, private readonly client: RosterClient, private readonly store: Store, private readonly meta: Map<string, MarketMeta>) {
    this.parser = new anchor.EventParser(client.programId, client.program.coder);
  }

  async snapshotMarket(m: MarketState): Promise<void> {
    const meta = this.meta.get(m.mint.toBase58());
    const row: MarketRow = {
      address: m.address.toBase58(), mint: m.mint.toBase58(), symbol: meta?.symbol ?? m.mint.toBase58().slice(0, 6), name: meta?.name ?? "", decimals: m.decimals, tier: m.tier, listed: m.listed ? 1 : 0, paused: m.paused ? 1 : 0,
      has_transfer_fee: m.hasTransferFee ? 1 : 0, has_permanent_delegate: m.hasPermanentDelegate ? 1 : 0, pausable: m.pausable ? 1 : 0, hook_program: m.hookProgram.toBase58(),
      token_feed_id: Buffer.from(m.tokenFeedId).toString("hex"), equity_feed_id: Buffer.from(m.equityFeedId).toString("hex"), allowed_expiries: JSON.stringify(m.allowedExpiries.map(String)),
      strike_step: m.strikeStep.toString(), min_strike: m.minStrike.toString(), max_strike: m.maxStrike.toString(), max_live_series: m.maxLiveSeries, live_series: m.liveSeries,
      min_lots6: m.minLots6.toString(), max_lots6: m.maxLots6.toString(), updated_at: Math.floor(Date.now() / 1000)
    };
    this.store.upsertMarket(row);
    const all = await this.client.fetchSeriesForMarket(m.address);
    const keep: string[] = [];
    for (const s of all) {
      const [cb, sb] = await Promise.all([this.balance(s.collateralVault), this.balance(s.settlementVault)]);
      const srow: SeriesRow = {
        address: s.address.toBase58(), market: s.market.toBase58(), side: s.side, strike_usdc_per_lot: s.strikeUsdcPerLot.toString(), expiry_ts: Number(s.expiryTs), position_mint: s.positionMint.toBase58(),
        collateral_vault: s.collateralVault.toBase58(), settlement_vault: s.settlementVault.toBase58(), quote_vault: s.quoteVault.toBase58(), total_sold_lots6: s.totalSoldLots6.toString(), total_exercised_lots6: s.totalExercisedLots6.toString(),
        unassigned_lots6: s.unassignedLots6.toString(), halted: s.halted ? 1 : 0,
        asks_json: JSON.stringify(s.asks.map((a) => ({ remaining_lots6: a.remainingLots6.toString(), ask_per_lot: a.askPerLot.toString(), seq: a.seq.toString(), writer_slot: a.writerSlot, writer: s.writers[a.writerSlot]?.writer.toBase58() ?? null }))),
        writers_json: JSON.stringify(s.writers.map((w) => ({ writer: w.writer.toBase58(), deposited_lots6: w.depositedLots6.toString(), withdrawn_lots6: w.withdrawnLots6.toString(), sold_lots6: w.soldLots6.toString(), open_lots6: w.openLots6.toString(), assigned_lots6: w.assignedLots6.toString(), premium_claimable: w.premiumClaimable.toString(), settled: w.settled }))),
        collateral_balance: cb.toString(), settlement_balance: sb.toString(), updated_at: Math.floor(Date.now() / 1000)
      };
      this.store.upsertSeries(srow);
      keep.push(srow.address);
    }
    this.store.deleteSeriesNotIn(row.address, keep);
  }

  private async balance(ata: PublicKey): Promise<bigint> {
    try {
      const info = await this.connection.getAccountInfo(ata);
      if (!info) return 0n;
      return (await getAccount(this.connection, ata, "confirmed", info.owner)).amount;
    } catch {
      return 0n;
    }
  }

  /** Pull the program signatures not yet read and store their events. Returns how many events were new. */
  async pullEvents(limit = 1000): Promise<number> {
    // Newest first, paging back until a whole page is already known. No `until` cursor: surfpool answers it with an
    // internal error, and after a time travel the fork can list a newer transaction under a lower slot than an
    // older one, so "everything above the last signature" would skip it. Dedupe by signature instead; in steady
    // state this is one page and no transaction fetches.
    const sigs: ConfirmedSignatureInfo[] = [];
    let before: string | undefined;
    for (let pages = 0; pages < 10; pages++) {
      let page: ConfirmedSignatureInfo[];
      try {
        page = await this.connection.getSignaturesForAddress(this.client.programId, before ? { limit, before } : { limit }, "confirmed");
      } catch (e) {
        // surfpool cannot page with `before` past what it has; keep what the first page gave rather than lose it.
        if (before) break;
        throw e;
      }
      const fresh = page.filter((s) => !this.store.hasSignature(s.signature));
      sigs.push(...fresh);
      if (fresh.length === 0 || page.length < limit) break;
      before = page[page.length - 1]!.signature;
    }
    let added = 0;
    // Oldest first so events land in the order they happened.
    for (const s of sigs.reverse()) {
      const tx = await this.connection.getTransaction(s.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
      const logs = tx?.meta?.logMessages ?? [];
      // surfpool reports block times that are not unix seconds; fall back to the transaction's, then to now.
      const plausible = (t: number | null | undefined) => (t && t > 1_000_000_000 ? t : null);
      const blockTime = plausible(s.blockTime) ?? plausible(tx?.blockTime) ?? Math.floor(Date.now() / 1000);
      let i = 0;
      for (const ev of this.parser.parseLogs(logs, false)) {
        const data = plain(ev.data);
        // The parser hands back camelCase names; store the IDL's PascalCase so the API matches the program's event names.
        const name = ev.name.charAt(0).toUpperCase() + ev.name.slice(1);
        if (this.store.insertEvent({ signature: s.signature, ix_index: i, slot: s.slot, block_time: blockTime, name, data_json: JSON.stringify(data) })) added += 1;
        i += 1;
      }
      if (tx?.meta?.err) {
        // Failed transactions are part of the roster's honesty: record them so a declined exercise shows up.
        if (this.store.insertEvent({ signature: s.signature, ix_index: 999, slot: s.slot, block_time: blockTime, name: "Failed", data_json: JSON.stringify({ err: tx.meta.err, logs: logs.slice(-3) }) })) added += 1;
      }
      this.store.markSignature(s.signature, s.slot);
    }
    return added;
  }

  protection(row: SeriesRow, s: SeriesState): Protection {
    const history = this.store.events({ series: row.address, limit: 50 }).filter((e) => ["Exercised", "WriterSettled", "SeriesClosed", "Failed"].includes(e.name)).map((e) => ({ signature: e.signature, block_time: e.block_time, name: e.name, data: JSON.parse(e.data_json) }));
    const capacity = s.asks.reduce((a, x) => a + x.remainingLots6, 0n);
    return {
      series: row.address, market: row.market, side: row.side, strike_usdc_per_lot: row.strike_usdc_per_lot, expiry_ts: row.expiry_ts,
      fillable: STANDARD_SIZES.map((n) => fillableAt(s, n)),
      reserved: { collateral_vault: row.collateral_vault, collateral_balance: row.collateral_balance, settlement_vault: row.settlement_vault, settlement_balance: row.settlement_balance, quote_vault: row.quote_vault },
      capacity_lots6: capacity.toString(), open_lots6: (s.totalSoldLots6 - s.totalExercisedLots6).toString(), writers_live: s.writers.filter((w) => !w.settled && (w.depositedLots6 > w.withdrawnLots6)).length, history
    };
  }
}
