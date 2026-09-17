/*
 * The indexer's store: a small SQL schema behind an interface, `node:sqlite` on the fork, Postgres later by adding a
 * second implementation (the SQL here is ANSI: TEXT keys, INTEGER amounts as strings where they exceed 2^53).
 * The indexer is a rebuildable projection of program state and events, never a system of record.
 */
import { DatabaseSync } from "node:sqlite";

export interface MarketRow {
  address: string;
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  tier: number;
  listed: number;
  paused: number;
  has_transfer_fee: number;
  has_permanent_delegate: number;
  pausable: number;
  hook_program: string;
  token_feed_id: string;
  equity_feed_id: string;
  allowed_expiries: string;
  strike_step: string;
  min_strike: string;
  max_strike: string;
  max_live_series: number;
  live_series: number;
  min_lots6: string;
  max_lots6: string;
  updated_at: number;
}

export interface SeriesRow {
  address: string;
  market: string;
  side: string;
  strike_usdc_per_lot: string;
  expiry_ts: number;
  position_mint: string;
  collateral_vault: string;
  settlement_vault: string;
  quote_vault: string;
  total_sold_lots6: string;
  total_exercised_lots6: string;
  unassigned_lots6: string;
  halted: number;
  asks_json: string;
  writers_json: string;
  collateral_balance: string;
  settlement_balance: string;
  updated_at: number;
}

export interface EventRow {
  signature: string;
  slot: number;
  block_time: number;
  ix_index: number;
  name: string;
  data_json: string;
}

export interface PriceRow {
  feed_id: string;
  price: number;
  conf: number;
  publish_time: number;
}

export interface Store {
  upsertMarket(m: MarketRow): void;
  markets(): MarketRow[];
  upsertSeries(s: SeriesRow): void;
  deleteSeriesNotIn(market: string, keep: string[]): void;
  series(market?: string): SeriesRow[];
  seriesByAddress(address: string): SeriesRow | null;
  insertEvent(e: EventRow): boolean;
  events(filter?: { name?: string | undefined; series?: string | undefined; wallet?: string | undefined; limit?: number | undefined }): EventRow[];
  /** Every signature already read, with or without events, so a re-listed one is never fetched twice. */
  hasSignature(sig: string): boolean;
  markSignature(sig: string, slot: number): void;
  recordPrice(p: PriceRow): void;
  latestPrice(feedId: string): PriceRow | null;
  priceHistory(feedId: string, sinceUnix: number): PriceRow[];
  recordBasis(mint: string, bps: number, at: number): void;
  basisHistory(mint: string, sinceUnix: number): { bps: number; at: number }[];
  setKv(key: string, value: string): void;
  getKv(key: string): string | null;
}

const SCHEMA = `
create table if not exists markets (
  address text primary key, mint text not null, symbol text, name text, decimals integer, tier integer, listed integer, paused integer,
  has_transfer_fee integer, has_permanent_delegate integer, pausable integer, hook_program text, token_feed_id text, equity_feed_id text,
  allowed_expiries text, strike_step text, min_strike text, max_strike text, max_live_series integer, live_series integer,
  min_lots6 text, max_lots6 text, updated_at integer
);
create table if not exists series (
  address text primary key, market text not null, side text, strike_usdc_per_lot text, expiry_ts integer, position_mint text,
  collateral_vault text, settlement_vault text, quote_vault text, total_sold_lots6 text, total_exercised_lots6 text,
  unassigned_lots6 text, halted integer, asks_json text, writers_json text, collateral_balance text, settlement_balance text, updated_at integer
);
create index if not exists series_market on series(market);
create table if not exists events (
  signature text not null, ix_index integer not null, slot integer, block_time integer, name text, data_json text,
  primary key (signature, ix_index)
);
create index if not exists events_name on events(name);
create table if not exists prices (feed_id text, price real, conf real, publish_time integer, primary key (feed_id, publish_time));
create table if not exists basis (mint text, bps real, at integer, primary key (mint, at));
create table if not exists kv (key text primary key, value text);
create table if not exists signatures (signature text primary key, slot integer not null);
`;

export class SqliteStore implements Store {
  private db: DatabaseSync;
  constructor(path = process.env.INDEXER_DB ?? ".keys/indexer.sqlite") {
    this.db = new DatabaseSync(path);
    this.db.exec("pragma journal_mode = wal;");
    this.db.exec(SCHEMA);
  }

  upsertMarket(m: MarketRow): void {
    const cols = Object.keys(m);
    this.db.prepare(`insert into markets (${cols.join(",")}) values (${cols.map((c) => `@${c}`).join(",")}) on conflict(address) do update set ${cols.filter((c) => c !== "address").map((c) => `${c}=excluded.${c}`).join(",")}`).run(m as unknown as Record<string, string | number>);
  }
  markets(): MarketRow[] {
    return this.db.prepare("select * from markets order by tier, symbol").all() as unknown as MarketRow[];
  }
  upsertSeries(s: SeriesRow): void {
    const cols = Object.keys(s);
    this.db.prepare(`insert into series (${cols.join(",")}) values (${cols.map((c) => `@${c}`).join(",")}) on conflict(address) do update set ${cols.filter((c) => c !== "address").map((c) => `${c}=excluded.${c}`).join(",")}`).run(s as unknown as Record<string, string | number>);
  }
  deleteSeriesNotIn(market: string, keep: string[]): void {
    const rows = this.db.prepare("select address from series where market = ?").all(market) as { address: string }[];
    const del = this.db.prepare("delete from series where address = ?");
    for (const r of rows) if (!keep.includes(r.address)) del.run(r.address);
  }
  series(market?: string): SeriesRow[] {
    return (market ? this.db.prepare("select * from series where market = ? order by expiry_ts, side, strike_usdc_per_lot").all(market) : this.db.prepare("select * from series order by expiry_ts, side, strike_usdc_per_lot").all()) as unknown as SeriesRow[];
  }
  seriesByAddress(address: string): SeriesRow | null {
    return (this.db.prepare("select * from series where address = ?").get(address) as unknown as SeriesRow | undefined) ?? null;
  }
  insertEvent(e: EventRow): boolean {
    const r = this.db.prepare("insert or ignore into events (signature, ix_index, slot, block_time, name, data_json) values (?, ?, ?, ?, ?, ?)").run(e.signature, e.ix_index, e.slot, e.block_time, e.name, e.data_json);
    return r.changes > 0;
  }
  events(filter: { name?: string | undefined; series?: string | undefined; wallet?: string | undefined; limit?: number | undefined } = {}): EventRow[] {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (filter.name) { where.push("name = ?"); args.push(filter.name); }
    if (filter.series) { where.push("data_json like ?"); args.push(`%"series":"${filter.series}"%`); }
    if (filter.wallet) { where.push("data_json like ?"); args.push(`%"${filter.wallet}"%`); }
    const sql = `select * from events ${where.length ? "where " + where.join(" and ") : ""} order by slot desc, ix_index desc limit ?`;
    args.push(filter.limit ?? 200);
    return this.db.prepare(sql).all(...args) as unknown as EventRow[];
  }
  hasSignature(sig: string): boolean {
    return !!this.db.prepare("select 1 from signatures where signature = ?").get(sig);
  }
  markSignature(sig: string, slot: number): void {
    this.db.prepare("insert or ignore into signatures (signature, slot) values (?, ?)").run(sig, slot);
  }
  recordPrice(p: PriceRow): void {
    this.db.prepare("insert or ignore into prices (feed_id, price, conf, publish_time) values (?, ?, ?, ?)").run(p.feed_id, p.price, p.conf, p.publish_time);
  }
  latestPrice(feedId: string): PriceRow | null {
    return (this.db.prepare("select * from prices where feed_id = ? order by publish_time desc limit 1").get(feedId) as unknown as PriceRow | undefined) ?? null;
  }
  priceHistory(feedId: string, sinceUnix: number): PriceRow[] {
    return this.db.prepare("select * from prices where feed_id = ? and publish_time >= ? order by publish_time").all(feedId, sinceUnix) as unknown as PriceRow[];
  }
  recordBasis(mint: string, bps: number, at: number): void {
    this.db.prepare("insert or ignore into basis (mint, bps, at) values (?, ?, ?)").run(mint, bps, at);
  }
  basisHistory(mint: string, sinceUnix: number): { bps: number; at: number }[] {
    return this.db.prepare("select bps, at from basis where mint = ? and at >= ? order by at").all(mint, sinceUnix) as unknown as { bps: number; at: number }[];
  }
  setKv(key: string, value: string): void {
    this.db.prepare("insert into kv (key, value) values (?, ?) on conflict(key) do update set value = excluded.value").run(key, value);
  }
  getKv(key: string): string | null {
    const r = this.db.prepare("select value from kv where key = ?").get(key) as { value: string } | undefined;
    return r?.value ?? null;
  }
}
