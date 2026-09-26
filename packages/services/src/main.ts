import "../../../scripts/env-load";
/*
 * One process on the fork (docs/01-architecture.md): oracle (Hermes, Benchmarks, multiplier watcher), indexer,
 * quoter, keeper and the REST the app reads. Each module keeps its own loop and keypair so splitting into per-tier
 * processes later is moving files. Flags: --no-quoter --no-keeper --once --port N.
 *
 * Fork-only: without a Pyth key the quoter prices off the issuer's quote (or REFERENCE_PRICE_<SYMBOL> in tests) only
 * when the RPC is loopback, which is where surfpool runs; a fork shares mainnet's genesis hash, so the RPC host is the
 * test. On any other cluster the quoter stays blocked on the key. Real data only outside test fixtures (CLAUDE.md 0).
 */
import { createServer } from "node:http";
import { gzipSync } from "node:zlib";
import { Connection, Keypair, PublicKey, type AccountInfo } from "@solana/web3.js";
import * as anchorNs from "@anchor-lang/core";
import { RosterClient, ROSTER_PROGRAM_ID, type MarketState, type VaultState, type VaultKind } from "@roster/sdk";
import { Hermes, HermesError, estimateVol, readMultiplier, sessionAt, volFromRecorded } from "@roster/oracle";
import { Indexer, SqliteStore, type MarketMeta } from "@roster/indexer";
import { Quoter, DEFAULT_QUOTER, VaultQuoter, DEFAULT_VAULT_QUOTER } from "@roster/quoter";
import { Keeper, DEFAULT_KEEPER } from "@roster/keeper";
import { failoverFetch, loadSecretKey, mapLimit, nextExpiries, rpcEndpoints, rpcHosts, rpcState } from "@roster/core";
import { issuerMark, jupiterPrice, launchSet, refreshSnapshots, snapshotOf, snapshotPrice, xstocksQuote, preipoTokens } from "./registry";
import { changePct, tokenHistory, type Candle, type Pool } from "@roster/registry";

const anchor = ((anchorNs as { default?: unknown }).default ?? anchorNs) as typeof anchorNs;
const args = new Set(process.argv.slice(2));
const flag = (name: string) => args.has(name);
const RPC = process.env.FORK_RPC_URL ?? process.env.RPC_URL ?? "http://127.0.0.1:8899";
const PORT = Number(process.env.PORT ?? process.env.SERVICES_PORT ?? 8787);
/* A host hands the process a port and reaches it from outside; a laptop keeps it on loopback. */
const BIND = process.env.SERVICES_BIND ?? (process.env.PORT ? "0.0.0.0" : "127.0.0.1");
const TICK_MS = Number(process.env.SERVICES_TICK_MS ?? 15_000);
/* Markets priced and cranked at once. A tick that walks four hundred markets one at a time is a tick that settles a
 * Friday's expiries minutes late; each market's accounts are disjoint, so the pass fans out. */
const MARKET_CONCURRENCY = Number(process.env.SERVICES_MARKET_CONCURRENCY ?? 2);

/** A role's key from the environment on a host, or from .keys on a laptop; a missing one is named, never guessed. */
function key(role: "DEPLOYER" | "KEEPER" | "QUOTER", fallbackPath: string): Keypair {
  const secret = loadSecretKey(role, fallbackPath);
  if (!secret) throw new Error(`no key for ${role}: set ${role}_SECRET_KEY (the 64 byte array) or put a keypair at ${fallbackPath}`);
  return Keypair.fromSecretKey(secret);
}

interface MarketLive {
  market: MarketState;
  meta: MarketMeta;
  price: number | null;
  priceAt: number;
  priceSource: "hermes" | "reference" | "tokens.xyz" | "xstocks" | "jupiter" | "prestocks" | "none";
  /** From the Tokens API snapshot where one exists: a real 24 hour change and holder count before this cluster has a price history of its own. */
  change24hPct: number | null;
  holders: number | null;
  /** Devnet only: the mainnet mint this market's token replicates, and takes its price from. */
  replicaOf: string | null;
  /** The issuer's logo and how many wrappers of the same stock the registry knows, from the cluster's own registry. */
  logo: string | null;
  wrappersOfUnderlying: number;
  underlyingSymbol: string | null;
  wrapper: "xStock" | "Ondo" | "PreStocks";
  feeBps: number;
  equityPrice: number | null;
  basisBps: number | null;
  /** Pre-IPO only: the issuer's mark beside the token price, and the token's spread to it in basis points, signed. */
  issuerMarkPrice: number | null;
  markSpreadBps: number | null;
  /** Pre-IPO only: from the reference pool's real trade history. */
  trade: { pool: string; poolAddress: string; liquidityUsd: number | null; volume24hUsd: number | null; change24hPct: number | null; change7dPct: number | null; change30dPct: number | null; daily: [number, number][]; days: number } | null;
  multiplier: number;
  pendingDividendMultiplier: number | null;
  pendingActivationTs: number | null;
  inActivationWindow: boolean;
  vol: number;
  volSource: string;
  session: string;
  paused: boolean;
}

async function main() {
  // The configured endpoint first, then any RPC_FALLBACK_URLS, then the public cluster endpoint; see core/rpc.ts.
  const rpcCluster = RPC.includes("127.0.0.1") || RPC.includes("localhost") ? null : RPC.includes("devnet") || process.env.NEXT_PUBLIC_CLUSTER === "devnet" ? "devnet" : process.env.NEXT_PUBLIC_CLUSTER ?? null;
  const connection = new Connection(RPC, { commitment: "confirmed", fetch: failoverFetch(rpcEndpoints(RPC, rpcCluster)) });
  const genesis = await connection.getGenesisHash();
  const isFork = RPC.includes("127.0.0.1") || RPC.includes("localhost");
  // Devnet is a real cluster with replica mints (docs/DEVNET.md): the same code, priced from each replica's mainnet
  // counterpart, and with every screen saying which cluster it is on.
  const isDevnet = !isFork && (RPC.includes("devnet") || process.env.NEXT_PUBLIC_CLUSTER === "devnet");
  const cluster = isFork ? "fork" : isDevnet ? "devnet" : process.env.NEXT_PUBLIC_CLUSTER ?? "mainnet";
  const deployer = key("DEPLOYER", ".keys/deployer.json");
  const quoterKey = key("QUOTER", ".keys/quoter.json");
  const keeperKey = key("KEEPER", ".keys/keeper.json");
  const reader = new RosterClient(connection, new anchor.Wallet(deployer));
  // Devnet runs on one funded wallet by design (docs/DEVNET.md): the deployer quotes and cranks. On mainnet the
  // quoter holds only what the operator is willing to have quoted, and the keeper only its fee SOL.
  const quoterClient = new RosterClient(connection, new anchor.Wallet(isDevnet ? deployer : quoterKey));
  // One wallet holds every role on the fork, and on devnet when the operator has funded only the deployer.
  const keeperClient = new RosterClient(connection, new anchor.Wallet(isFork || isDevnet ? deployer : keeperKey));
  const hermes = new Hermes(process.env.PYTH_CORE_API_KEY);
  const store = new SqliteStore(process.env.INDEXER_DB ?? `.keys/indexer-${cluster}.sqlite`);
  const launch = await launchSet(cluster);
  const meta = new Map<string, MarketMeta>(launch.map((l) => [l.mint.toBase58(), { mint: l.mint.toBase58(), symbol: l.symbol, name: l.name }]));
  const indexer = new Indexer(connection, reader, store, meta);
  /*
   * Every client reads a market's series from the addresses the indexer learned from SeriesCreated, not from a
   * program-wide scan: a free keyed devnet tier can refuse or throttle getProgramAccounts.
   * A series the store has not seen yet is picked up on the next events pull, seconds later.
   */
  for (const client of [reader, quoterClient, keeperClient]) {
    client.seriesIndex = (market) => store.knownSeries(market.toBase58()).map((a) => new PublicKey(a));
  }
  // A fresh store knows no series until the events backfill reaches each SeriesCreated, which behind a rate-limited
  // RPC can take an hour. The public cluster RPC still serves a filtered scan, so a store that has not finished its
  // backfill seeds each market's index from one scan there, and the app has quotes from the first tick. SCAN_RPC_URL
  // overrides it; on a fork it is the fork itself.
  const scanRpc = process.env.SCAN_RPC_URL ?? (isFork ? RPC : cluster === "devnet" ? "https://api.devnet.solana.com" : null);
  async function seedSeriesIndex(market: PublicKey): Promise<void> {
    if (!scanRpc || store.getKv("backfill_done") || store.knownSeries(market.toBase58()).length > 0) return;
    try {
      const disc = reader.program.coder.accounts.memcmp("series") as { offset: number; bytes: string };
      const found = await new Connection(scanRpc, "confirmed").getProgramAccounts(ROSTER_PROGRAM_ID, { dataSlice: { offset: 0, length: 0 }, filters: [{ memcmp: disc }, { memcmp: { offset: 8, bytes: market.toBase58() } }] });
      for (const a of found) store.rememberSeries(a.pubkey.toBase58(), market.toBase58());
      if (found.length) console.log(`[indexer] seeded ${found.length} series for ${market.toBase58().slice(0, 8)} from a scan; events backfill continues`);
    } catch (e) {
      console.warn(`[indexer] series scan: ${(e as Error).message}`);
    }
  }
  // QUOTER_LOTS_PER_SERIES caps the treasury's ask per series (docs/SEEDING.md sets it for the first mainnet week).
  // Devnet money is minted, so its book runs deep enough that a $200 ticket fills at one price; the fork keeps 50.
  const lotsPerSeries = BigInt(Math.round(Number(process.env.QUOTER_LOTS_PER_SERIES ?? (cluster === "devnet" ? 250 : 50)) * 1e6));
  const quoter = new Quoter(quoterClient, { ...DEFAULT_QUOTER, lotsPerSeries });
  // The expiry calendar. Mainnet expires on Fridays at 16:00 New York. Devnet runs a compressed calendar, an expiry
  // every day at 16:00 New York, so a whole cycle (quote, fill, exercise, settle, vault roll, published P&L) happens
  // daily and a week of judging shows a week of epochs. `KEEPER_EXPIRY_WEEKDAYS` overrides either.
  const weekdays = process.env.KEEPER_EXPIRY_WEEKDAYS ? process.env.KEEPER_EXPIRY_WEEKDAYS.split(",").map(Number).filter((d) => d >= 0 && d <= 6) : isDevnet ? [0, 1, 2, 3, 4, 5, 6] : DEFAULT_KEEPER.expiryWeekdays;
  const keeper = new Keeper(keeperClient, deployer.publicKey, { ...DEFAULT_KEEPER, expiryWeekdays: weekdays });
  // Part 3: the vault's leg of the quoter, signed by the vault's manager (the quoter wallet; the deployer on devnet).
  const vaultQuoter = new VaultQuoter(quoterClient, { ...DEFAULT_QUOTER, lotsPerSeries }, DEFAULT_VAULT_QUOTER);
  /** The vaults seen on the last tick, by market, for the REST. */
  const vaultsLive = new Map<string, VaultState[]>();
  let vaultsAnswer: { at: number; body: unknown[] } | null = null;
  const live = new Map<string, MarketLive>();
  let lastTick = 0;
  // The roster answer never waits on the RPC: the tick keeps the chain clock offset and the protocol account fresh,
  // and the serialized answer is reused for five seconds, so a slow endpoint cannot make a page wait.
  let clockOffset = 0;
  let protocolCache: Awaited<ReturnType<RosterClient["fetchProtocol"]>> | null = null;
  let rosterAnswer: { at: number; body: string } | null = null;
  let vaultsRefreshing: Promise<unknown[]> | null = null;
  let blocked: string | null = null;
  // Realised vol per symbol, refreshed hourly: Benchmarks is a slow, keyed endpoint and vol does not move per tick.
  const volCache = new Map<string, { at: number; v: Awaited<ReturnType<typeof estimateVol>> }>();
  /*
   * Trade history for every PreStocks token from its deepest USDC pool (GeckoTerminal, public, about thirty calls a
   * minute): daily and hourly candles kept in the store under `gt_day:<mainnet mint>` and `gt_hour:<mainnet mint>`,
   * the pool's liquidity and volume in memory. One token is refreshed at a time, forty-five seconds apart, so the rate
   * limit is never spent in a burst and a restart picks up where the store left off. The app reads it from here
   * and never calls GeckoTerminal itself.
   */
  const history = new Map<string, { pool: Pool; daily: Candle[]; hourly: Candle[]; at: number }>();
  async function refreshHistory(): Promise<void> {
    const tokens = [...(await preipoTokens()).values()];
    const stale = tokens.filter((t) => { const h = history.get(t.mint); return !h || Date.now() - h.at > 10 * 60_000; });
    const next = stale[0];
    if (!next) return;
    try {
      const h = await tokenHistory(next.mint);
      if (h && h.pool) {
        history.set(next.mint, { pool: h.pool, daily: h.daily, hourly: h.hourly, at: Date.now() });
        // Keyed by pool, so a change of reference pool never mixes two series under one mint.
        for (const c of h.daily) store.recordPrice({ feed_id: `gt_day:${h.pool.address}`, price: c[4], conf: 0, publish_time: c[0] });
        for (const c of h.hourly) store.recordPrice({ feed_id: `gt_hour:${h.pool.address}`, price: c[4], conf: 0, publish_time: c[0] });
        volCache.delete(next.symbol);
        console.log(`[history] ${next.symbol} ${h.pool.name}: ${h.daily.length} days, ${h.hourly.length} hours, liquidity $${Math.round(h.pool.liquidityUsd ?? 0)}`);
      } else {
        // No pool quoted in USDC, USDT or SOL: looked at again in an hour, not every ten minutes.
        history.set(next.mint, { pool: { address: "", name: "", liquidityUsd: null, volume24hUsd: null, priceUsd: null }, daily: [], hourly: [], at: Date.now() + 50 * 60_000 });
        console.log(`[history] ${next.symbol}: no USDC pool listed`);
      }
    } catch (e) {
      console.warn(`[history] ${next.symbol}: ${(e as Error).message.slice(0, 120)}`);
      // A refused call (429) waits its turn again rather than retrying at once.
      const h = history.get(next.mint);
      history.set(next.mint, h ? { ...h, at: Date.now() - 8 * 60_000 } : { pool: { address: "", name: "", liquidityUsd: null, volume24hUsd: null, priceUsd: null }, daily: [], hourly: [], at: Date.now() - 8 * 60_000 });
    }
  }
  /** Daily closes for a PreStocks token from its current reference pool; empty until the pool has been read this run. */
  function dailyCloses(mainnetMint: string): { publish_time: number; price: number }[] {
    const pool = history.get(mainnetMint)?.pool.address;
    return pool ? store.priceHistory(`gt_day:${pool}`, Math.floor(Date.now() / 1000) - 400 * 86_400) : [];
  }

  // A pre-IPO token has no Benchmarks symbol: its vol is measured from the real daily closes of its reference pool
  // (GeckoTerminal), else from the marks this process records, behind a stated floor until a week of either exists.
  const PREIPO_VOL_FLOOR = Number(process.env.PREIPO_VOL_FLOOR ?? 0.9);
  async function volFor(symbol: string, mint: PublicKey, wrapper: string, replicaOf: string | null) {
    const hit = volCache.get(symbol);
    if (hit && Date.now() - hit.at < 3_600_000) return hit.v;
    let v: Awaited<ReturnType<typeof estimateVol>>;
    if (wrapper === "PreStocks") {
      const closes = dailyCloses(replicaOf ?? mint.toBase58());
      v = closes.length >= 7 ? { ...volFromRecorded(closes, PREIPO_VOL_FLOOR), source: "recorded" as const } : volFromRecorded(store.priceHistory(`mark:${mint.toBase58()}`, Math.floor(Date.now() / 1000) - 92 * 86_400), PREIPO_VOL_FLOOR);
      if (closes.length >= 7 && v.vol30 === null && v.vol7 === null) v = { ...v, source: "preipo_floor" };
    } else {
      v = await estimateVol(`Crypto.${symbol.toUpperCase()}/USD`, Number(process.env.VOL_FLOOR ?? 0.35), process.env.PYTH_CORE_API_KEY);
    }
    volCache.set(symbol, { at: Date.now(), v });
    return v;
  }
  console.log(`[services] cluster=${cluster} genesis=${genesis.slice(0, 8)} program=${ROSTER_PROGRAM_ID.toBase58()} hermes=${hermes.keyed ? "keyed" : "NO KEY"} markets=${launch.map((l) => l.symbol).join(",")}`);

  // Events are pulled on their own short loop as well as at the end of each tick: a tick that reprices every series
  // can take a minute, and a receipt should not wait for it. One pull at a time, and a caller arriving mid-pull waits
  // for that one instead of skipping the read: the positions endpoint pulls before it answers, so two people
  // refreshing at once both see the finished scan.
  let pulling: Promise<void> | null = null;
  function pullEvents(): Promise<void> {
    if (pulling) return pulling;
    const run = (async () => {
      try {
        const started = Date.now();
        const added = await indexer.pullEvents();
        const took = Date.now() - started;
        // Indexer lag is what a person feels as "my receipt has not arrived": say it whenever a pull is slow.
        if (took > 2_000) console.log(`[indexer] pull ${added} events in ${took} ms`);
      } catch (e) {
        console.warn(`[indexer] events: ${(e as Error).message}`);
      } finally {
        pulling = null;
      }
    })();
    pulling = run;
    return run;
  }

  /*
   * The mark for one market, per share, in the order the sources deserve: an issuer that publishes a mark for its own
   * token (PreStocks), then the Tokens API snapshot, then Jupiter's routed price, then the xStocks quote.
   * A devnet replica is priced from `replicaOf`, the mainnet mint it stands in for, so its screen shows the market's
   * numbers and not an invention. Routed and snapshot prices are per token, so the multiplier converts them.
   */
  async function markFor(l: (typeof launch)[number], multiplier: number): Promise<{ price: number; source: MarketLive["priceSource"]; issuerMark?: number | null } | null> {
    const ref = process.env[`REFERENCE_PRICE_${l.symbol.toUpperCase()}`];
    if (ref && Number(ref) > 0) return { price: Number(ref), source: "reference" };
    const im = await issuerMark(l);
    if (im) return { price: im.price, source: im.source, issuerMark: im.mark };
    const priced = l.replicaOf ?? l.mint.toBase58();
    const snap = snapshotPrice(priced);
    if (snap) return { price: snap / (multiplier || 1), source: "tokens.xyz" };
    const routed = await jupiterPrice(priced).catch(() => null);
    if (routed) return { price: routed / (multiplier || 1), source: "jupiter" };
    const quote = (await xstocksQuote(l.symbol).catch(() => null)) ?? (l.underlyingSymbol ? await xstocksQuote(`${l.underlyingSymbol}x`).catch(() => null) : null);
    return quote ? { price: quote, source: "xstocks" } : null;
  }

  async function tick(): Promise<void> {
    const nowTs = await clockUnix(connection).catch(() => Math.floor(Date.now() / 1000) + clockOffset);
    clockOffset = nowTs - Math.floor(Date.now() / 1000);
    protocolCache = await reader.fetchProtocol().catch(() => protocolCache);
    // On the public endpoint every read is paced; one market at a time keeps a tick inside the pace.
    const concurrency = rpcState.degraded ? 1 : MARKET_CONCURRENCY;
    // One batched snapshot call for every market, cached for a minute inside the registry module.
    await refreshSnapshots(launch.map((l) => l.replicaOf ?? l.mint.toBase58()));
    await mapLimit(launch, concurrency, async (l) => {
      const market = await reader.fetchMarket(l.mint);
      if (!market) return;
      await seedSeriesIndex(market.address);
      const feedId = Buffer.from(market.tokenFeedId).toString("hex");
      const equityFeed = Buffer.from(market.equityFeedId).toString("hex");
      // The multiplier is read first: a routed price is per token, and the display strike divides by it.
      const mult = await readMultiplier(connection, l.symbol, l.mint, nowTs);
      let price: number | null = null;
      let equityPrice: number | null = null;
      let priceAt = 0;
      let priceSource: MarketLive["priceSource"] = "none";
      let issuerMarkPrice: number | null = null;
      const noFeed = /^0+$/.test(feedId);
      if (noFeed) {
        // No Pyth feed for this wrapper, which is every market while the key's grant excludes them: the issuer's own
        // mark, the Tokens API snapshot and the routed price are the sources, in that order, on every cluster.
        const m = await markFor(l, mult.onChain);
        if (m) { price = m.price; priceAt = nowTs; priceSource = m.source; issuerMarkPrice = m.issuerMark ?? null; } else console.warn(`[oracle] ${l.symbol}: no mark from any source`);
      } else {
        // Without a Pyth price for the token feed the issuer's own quote stands in: on the fork the quoter may price
        // off it (a test device, refused elsewhere by the loopback rule); on a real cluster it is a display mark only.
        const issuerFallback = async () => {
          const m = await markFor(l, mult.onChain);
          if (m) { price = m.price; priceAt = nowTs; priceSource = m.source; }
        };
        try {
          const samples = await hermes.latest([feedId, equityFeed].filter((f) => !/^0+$/.test(f)));
          const t = samples.get(feedId);
          if (t) { price = t.price; priceAt = t.publishTime; priceSource = "hermes"; store.recordPrice({ feed_id: feedId, price: t.price, conf: t.conf, publish_time: t.publishTime }); }
          const e = samples.get(equityFeed);
          if (e) { equityPrice = e.price; store.recordPrice({ feed_id: equityFeed, price: e.price, conf: e.conf, publish_time: e.publishTime }); }
          if (t) blocked = null;
          else {
            // The equity reference may be inside the key's grant while the token feed is not: use what is served.
            const why = hermes.entitlementError(feedId);
            if (why) blocked = `PYTH_CORE_API_KEY grant: ${why}`;
            await issuerFallback();
          }
        } catch (err) {
          await issuerFallback();
          if (err instanceof HermesError && err.status === 401) blocked = "PYTH_CORE_API_KEY";
          else if (err instanceof HermesError && err.status === 403) blocked = `PYTH_CORE_API_KEY grant: ${err.message.replace(/^Hermes 403: /, "")}`;
          else console.warn(`[oracle] ${l.symbol}: ${(err as Error).message}`);
        }
      }
      // Every mark is recorded under the mint, whichever source priced it, so the app can chart a market's history.
      if (price !== null) store.recordPrice({ feed_id: `mark:${l.mint.toBase58()}`, price, conf: 0, publish_time: Math.floor(Date.now() / 1000) });
      // A pre-IPO token's spread to the issuer's mark is recorded beside it: a premium or a discount, never a basis
      // an arbitrage could close, so it never reaches the basis breaker.
      const markSpreadBps = price !== null && issuerMarkPrice ? ((price - issuerMarkPrice) / issuerMarkPrice) * 10_000 : null;
      if (issuerMarkPrice !== null) store.recordPrice({ feed_id: `issuer_mark:${l.mint.toBase58()}`, price: issuerMarkPrice, conf: 0, publish_time: Math.floor(Date.now() / 1000) });
      const vol = await volFor(l.symbol, l.mint, l.wrapper, l.replicaOf);
      const session = sessionAt(nowTs);
      const basisBps = price !== null && equityPrice !== null && session === "regular" ? ((price - equityPrice) / equityPrice) * 10_000 : null;
      if (basisBps !== null) store.recordBasis(l.mint.toBase58(), basisBps, nowTs);
      const noSession = l.wrapper === "PreStocks";
      const paused = await keeper.mintPaused(market.mint, market.tokenProgram);
      const snap = snapshotOf(l.replicaOf ?? l.mint.toBase58());
      const hist = l.wrapper === "PreStocks" ? history.get(l.replicaOf ?? l.mint.toBase58()) : undefined;
      const trade: MarketLive["trade"] = hist && hist.pool.address ? { pool: hist.pool.name, poolAddress: hist.pool.address, liquidityUsd: hist.pool.liquidityUsd, volume24hUsd: hist.pool.volume24hUsd, change24hPct: changePct(hist.hourly, 86_400), change7dPct: changePct(hist.daily, 7 * 86_400), change30dPct: changePct(hist.daily, 30 * 86_400), daily: hist.daily.slice(-90).map((c) => [c[0], c[4]] as [number, number]), days: hist.daily.length } : null;
      const state: MarketLive = { trade, change24hPct: trade?.change24hPct ?? snap?.change24hPct ?? null, holders: snap?.holders ?? null, replicaOf: l.replicaOf, logo: l.logo ?? snap?.logo ?? null, wrappersOfUnderlying: l.wrappersOfUnderlying, underlyingSymbol: l.underlyingSymbol, market, meta: meta.get(l.mint.toBase58())!, price, priceAt, priceSource, wrapper: l.wrapper, feeBps: l.feeBps, equityPrice, basisBps, issuerMarkPrice, markSpreadBps, multiplier: mult.onChain, pendingDividendMultiplier: mult.pendingMultiplier !== null && mult.pendingIsDividend && mult.pendingAt !== null && market.allowedExpiries.some((e) => e > BigInt(mult.pendingAt!)) ? mult.pendingMultiplier : null, pendingActivationTs: mult.pendingAt, inActivationWindow: mult.inWindow, vol: vol.blended, volSource: vol.source, session, paused };
      live.set(l.symbol, state);
      if (!flag("--no-keeper")) {
        // Devnet keeps the next two Fridays on the grid beside its daily expiries, so "through Friday" is always a
        // quoted term and a weekend is always in reach; mainnet's grid is Fridays already.
        const fridays = cluster === "devnet" ? nextExpiries(nowTs, 2, [5]).map(BigInt) : [];
        await keeper.rollGrid(market, nowTs, [...(process.env.EXTRA_EXPIRIES ?? "").split(",").filter(Boolean).map(BigInt), ...fridays]);
        await keeper.cycle(await reader.fetchMarket(l.mint) ?? market, nowTs, paused);
      }
      // The quoter prices only off Hermes, or off the issuer quote on the fork; a real cluster without a key does not
      // quote. A vol that fell back to the floor is a breaker off the fork unless the operator accepts it in writing.
      /*
       * What the treasury is willing to quote against. Mainnet wants an oracle or the issuer of the token itself. The
       * fork and devnet are test capital on test assets, so any real source will do, and the app prints which one
       * priced every mark. A vol that fell back to the floor is a breaker on mainnet only, for the same reason.
       */
      const testCluster = isFork || isDevnet;
      const canQuote = priceSource === "hermes" || priceSource === "prestocks" || (testCluster && priceSource !== "none");
      const volOk = vol.source !== "floor" || testCluster || process.env.VOL_FLOOR_OK === "1";
      if (!flag("--no-quoter")) {
        if (price === null || !canQuote || !volOk) {
          await quoter.pullQuotes(market, l.symbol, nowTs, price === null ? "no price" : !canQuote ? "no oracle or issuer price on this cluster" : "volatility fell back to the floor");
        } else {
        const fresh = (await reader.fetchMarket(l.mint)) ?? market;
        // Price age against the wall clock: the chain clock can be time-travelled on a fork, publish times cannot.
        const ageSecs = priceSource === "hermes" ? Math.max(0, Math.floor(Date.now() / 1000) - priceAt) : 0;
        // Sides a vault quotes here: the treasury keeps the grid but leaves those asks to the vault, unless
        // QUOTER_BESIDE_VAULT says both quote. Devnet does, so a featured term carries the treasury's depth as well as
        // the vault's and a buyer walks the cheaper of the two first; a vault's own book is what its depositors are
        // paid on, so on mainnet the treasury steps back by default.
        const vaultSides = new Set<"call" | "put">();
        if ((process.env.QUOTER_BESIDE_VAULT ?? (cluster === "devnet" ? "1" : "0")) !== "1") {
          for (const kind of ["covered_call", "cash_secured_put"] as VaultKind[]) {
            const v = await reader.fetchVault(fresh, kind).catch(() => null);
            if (v && v.totalShares > 0n && !v.halted) vaultSides.add(kind === "covered_call" ? "call" : "put");
          }
        }
        await quoter.cycle({ market: fresh, symbol: l.symbol, tier: l.tier, feeBps: l.feeBps, graceSecs: Number((await reader.fetchProtocol()).graceSecs), price, priceAgeSecs: ageSecs, equityPrice, multiplier: mult.onChain, pendingDividendMultiplier: state.pendingDividendMultiplier, inActivationWindow: mult.inWindow, vol: vol.blended, nowTs, noSession }, vaultSides);
        }
      }
      // Part 3: the vaults on this market. Cranks first (settle, roll, claim), then the two-sided quote.
      const vaults: VaultState[] = [];
      for (const kind of ["covered_call", "cash_secured_put"] as VaultKind[]) {
        const v = await reader.fetchVault(market, kind).catch(() => null);
        if (v) vaults.push(v);
      }
      if (vaults.length) {
        const fresh = (await reader.fetchMarket(l.mint)) ?? market;
        const series = await reader.fetchSeriesForMarket(fresh.address);
        const markPerLot = price !== null ? BigInt(Math.round(price * (mult.onChain || 1) * 1e6)) : 0n;
        for (const v of vaults) {
          if (!flag("--no-keeper") && markPerLot > 0n) await keeper.vaultCycle(fresh, v, series, nowTs, markPerLot);
          if (!flag("--no-quoter") && price !== null && canQuote && volOk) {
            const again = (await reader.fetchVault(fresh, v.kind)) ?? v;
            const ageSecs = priceSource === "hermes" ? Math.max(0, Math.floor(Date.now() / 1000) - priceAt) : 0;
            await vaultQuoter.cycle({ market: fresh, symbol: l.symbol, tier: l.tier, feeBps: l.feeBps, graceSecs: Number((await reader.fetchProtocol()).graceSecs), price, priceAgeSecs: ageSecs, equityPrice, multiplier: mult.onChain, pendingDividendMultiplier: state.pendingDividendMultiplier, inActivationWindow: mult.inWindow, vol: vol.blended, nowTs, noSession }, again, await reader.fetchSeriesForMarket(fresh.address));
          }
        }
        const after: VaultState[] = [];
        for (const v of vaults) after.push((await reader.fetchVault(market, v.kind)) ?? v);
        vaultsLive.set(l.symbol, after);
      } else {
        vaultsLive.delete(l.symbol);
      }
      await indexer.snapshotMarket((await reader.fetchMarket(l.mint)) ?? market);
    });
    await pullEvents();
    lastTick = Date.now();
    rosterAnswer = null;
    if (!vaultsRefreshing) vaultsRefreshing = readVaults().catch(() => vaultsAnswer?.body ?? []).finally(() => { vaultsRefreshing = null; });
    if (blocked) console.warn(`[services] blocked on ${blocked}: the quoter cannot price (docs/OPERATOR.md)`);
  }

  /** Every vault's balances and epoch records, read side by side; the tick keeps this warm so no request waits on the RPC. */
  const readVaults = async (): Promise<unknown[]> => {
    const all = [...vaultsLive].flatMap(([symbol, vs]) => vs.map((v) => ({ symbol, v })));
    const out = await Promise.all(all.map(async ({ symbol, v }) => {
      {
        const epochs = v.epoch > 0 ? await reader.fetchEpochRecords(v.address, Array.from({ length: Math.min(v.epoch, 30) }, (_, i) => v.epoch - 1 - i)).catch(() => []) : [];
        const [collateral, other] = await Promise.all([connection.getAccountInfo(v.collateralAta, "confirmed"), connection.getAccountInfo(v.otherAta, "confirmed")]);
        return ({
          symbol, address: v.address.toBase58(), kind: v.kind, halted: v.halted, manager: v.manager.toBase58(), shareMint: v.shareMint.toBase58(),
          collateralMint: v.collateralMint.toBase58(), otherMint: v.otherMint.toBase58(), collateralAta: v.collateralAta.toBase58(), otherAta: v.otherAta.toBase58(),
          collateralBalance: collateral ? collateral.data.readBigUInt64LE(64).toString() : "0", otherBalance: other ? other.data.readBigUInt64LE(64).toString() : "0",
          epoch: v.epoch, epochStartTs: Number(v.epochStartTs), nextRollTs: Number(v.nextRollTs), rollIntervalSecs: Number(v.rollIntervalSecs),
          totalShares: v.totalShares.toString(), lockedRaw: v.lockedRaw.toString(), pendingDepositRaw: v.pendingDepositRaw.toString(), pendingWithdrawShares: v.pendingWithdrawShares.toString(),
          reservedCollateralRaw: v.reservedCollateralRaw.toString(), reservedOther: v.reservedOther.toString(), capPerSeriesLots6: v.capPerSeriesLots6.toString(), spreadBps: v.spreadBps,
          lastMarkUsdcPerLot: v.lastMarkUsdcPerLot.toString(), markBandBps: v.markBandBps, epochPremiumIn: v.epochPremiumIn.toString(), epochBuybackOut: v.epochBuybackOut.toString(), epochAssignedLots6: v.epochAssignedLots6.toString(),
          navPerShare1e6: v.navPerShare1e6.toString(), epochPnlPerShare1e6: v.epochPnlPerShare1e6.toString(),
          epochs: epochs.sort((a, b) => a.epoch - b.epoch).map((r) => ({ epoch: r.epoch, rolledAt: Number(r.rolledAt), navCollateralRaw: r.navCollateralRaw.toString(), navOther: r.navOther.toString(), markUsdcPerLot: r.markUsdcPerLot.toString(), totalSharesAfter: r.totalSharesAfter.toString(), premiumIn: r.premiumIn.toString(), buybackOut: r.buybackOut.toString(), assignedLots6: r.assignedLots6.toString(), pnlPerShare1e6: r.pnlPerShare1e6.toString(), sharesPerRaw1e12: r.sharesPerRaw1e12.toString(), collateralPerShare1e12: r.collateralPerShare1e12.toString(), otherPerShare1e12: r.otherPerShare1e12.toString() })),
        });
      }
    }));
    vaultsAnswer = { at: Date.now(), body: out };
    return out;
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const stringify = (body: unknown) => JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    // Answers above a kilobyte go out gzipped when the caller accepts it: the roster is a few hundred KB of JSON.
    const gzipOk = /\bgzip\b/.test(String(req.headers["accept-encoding"] ?? ""));
    const send = (code: number, text: string) => {
      if (gzipOk && text.length > 1024) { res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*", "content-encoding": "gzip", vary: "accept-encoding" }); res.end(gzipSync(text)); }
      else { res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*" }); res.end(text); }
    };
    const json = (code: number, body: unknown) => send(code, stringify(body));
    try {
      if (url.pathname === "/v1/health") return json(200, { ok: true, cluster, lastTick, blocked, tickMs: TICK_MS, program: ROSTER_PROGRAM_ID.toBase58(), hermesKeyed: hermes.keyed, rpc: rpcHosts(process.env.RPC_URL ?? "", process.env.NEXT_PUBLIC_CLUSTER ?? null) });
      if (url.pathname === "/v1/roster") {
        if (rosterAnswer && Date.now() - rosterAnswer.at < 5_000) return send(200, rosterAnswer.body);
        const nowTs = Math.floor(Date.now() / 1000) + clockOffset;
        const wall = Math.floor(Date.now() / 1000);
        const markets = [...live.values()].map((m) => ({ symbol: m.meta.symbol, name: m.meta.name, wrapper: m.wrapper, feeBps: m.feeBps, mint: m.market.mint.toBase58(), sparkline: store.priceHistory(`mark:${m.market.mint.toBase58()}`, wall - 86_400).map((p) => [p.publish_time, Number(p.price.toPrecision(6))] as [number, number]).filter((_, i, a) => i % Math.max(1, Math.floor(a.length / 96)) === 0), market: m.market.address.toBase58(), decimals: m.market.decimals, tier: m.market.tier, listed: m.market.listed, paused: m.market.paused || m.paused, hasTransferFee: m.market.hasTransferFee, hasPermanentDelegate: m.market.hasPermanentDelegate, pausable: m.market.pausable, hookProgram: m.market.hookProgram.toBase58(), allowedExpiries: m.market.allowedExpiries.map(String), strikeStep: m.market.strikeStep.toString(), minLots6: m.market.minLots6.toString(), maxLots6: m.market.maxLots6.toString(), maxLiveSeries: m.market.maxLiveSeries, liveSeries: m.market.liveSeries, price: m.price, priceAt: m.priceAt, priceSource: m.priceSource, change24hPct: m.change24hPct, holders: m.holders, replicaOf: m.replicaOf, logo: m.logo, wrappersOfUnderlying: m.wrappersOfUnderlying, underlyingSymbol: m.underlyingSymbol, equityPrice: m.equityPrice, basisBps: m.basisBps, issuerMarkPrice: m.issuerMarkPrice, markSpreadBps: m.markSpreadBps, trade: m.trade, markSparkline: m.issuerMarkPrice !== null ? store.priceHistory(`issuer_mark:${m.market.mint.toBase58()}`, wall - 86_400).map((p) => [p.publish_time, Number(p.price.toPrecision(6))] as [number, number]).filter((_, i, a) => i % Math.max(1, Math.floor(a.length / 96)) === 0) : undefined, multiplier: m.multiplier, pendingActivationTs: m.pendingActivationTs, inActivationWindow: m.inActivationWindow, vol: m.vol, volSource: m.volSource, series: store.series(m.market.address.toBase58()).map((s) => ({ ...s, asks: JSON.parse(s.asks_json), writers: JSON.parse(s.writers_json), asks_json: undefined, writers_json: undefined })) }));
        const protocol = protocolCache;
        const text = stringify({ cluster, programDeployed: true, program: ROSTER_PROGRAM_ID.toBase58(), nowTs, session: sessionAt(nowTs), feeBps: protocol?.feeBps ?? null, keeperFeeUsdc: protocol?.keeperFeeUsdc.toString() ?? null, graceSecs: protocol?.graceSecs.toString() ?? null, treasury: protocol?.treasury.toBase58() ?? null, quoter: quoterClient.wallet.toBase58(), blocked, hermesKeyed: hermes.keyed, markets, quoterLog: quoter.log.slice(-40), keeperLog: keeper.log.slice(-40) });
        rosterAnswer = { at: Date.now(), body: text };
        return send(200, text);
      }
      const prot = url.pathname.match(/^\/v1\/protection\/([1-9A-HJ-NP-Za-km-z]+)$/);
      if (prot) {
        const row = store.seriesByAddress(prot[1]!);
        const s = await reader.fetchSeries(new PublicKey(prot[1]!));
        if (!row || !s) return json(404, { error: "series not indexed" });
        return json(200, indexer.protection(row, s));
      }
      const pos = url.pathname.match(/^\/v1\/positions\/([1-9A-HJ-NP-Za-km-z]+)$/);
      if (pos) {
        const wallet = new PublicKey(pos[1]!);
        // Read the chain's events before answering: a person who just signed reloads within seconds, and their own
        // receipt arriving on the indexer's next scheduled pull is the difference between "done" and "did it work?".
        await pullEvents();
        const { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID } = await import("@solana/spl-token");
        const { autoExercisePda } = await import("@roster/sdk");
        const rows = store.series();
        // One RPC round trip for every position ATA, then one for the opt-ins of the positions that exist.
        const atas = rows.map((row) => getAssociatedTokenAddressSync(new PublicKey(row.position_mint), wallet, false, TOKEN_2022_PROGRAM_ID));
        const infos = await inChunks(connection, atas);
        const held = rows.map((row, i) => ({ row, amount: infos[i] ? infos[i]!.data.readBigUInt64LE(64) : 0n })).filter((x) => x.amount > 0n);
        const optIns = await inChunks(connection, held.map((x) => autoExercisePda(ROSTER_PROGRAM_ID, wallet, new PublicKey(x.row.address))));
        const out = held.map((x, i) => ({ series: x.row.address, market: x.row.market, side: x.row.side, strike_usdc_per_lot: x.row.strike_usdc_per_lot, expiry_ts: x.row.expiry_ts, position_mint: x.row.position_mint, lots6: x.amount.toString(), autoExercise: !!optIns[i] }));
        return json(200, { wallet: wallet.toBase58(), positions: out, events: store.events({ wallet: wallet.toBase58(), limit: 100 }) });
      }
      const th = url.pathname.match(/^\/v1\/history\/([1-9A-HJ-NP-Za-km-z]+)$/);
      if (th) {
        const mainnetMint = th[1]!;
        const h = history.get(mainnetMint);
        const since = Number(url.searchParams.get("since") ?? 0);
        return json(200, {
          mint: mainnetMint,
          pool: h?.pool.address ? { name: h.pool.name, address: h.pool.address, liquidityUsd: h.pool.liquidityUsd, volume24hUsd: h.pool.volume24hUsd } : null,
          daily: h?.pool.address ? store.priceHistory(`gt_day:${h.pool.address}`, since).map((p) => [p.publish_time, p.price]) : [],
          hourly: h?.pool.address ? store.priceHistory(`gt_hour:${h.pool.address}`, since).map((p) => [p.publish_time, p.price]) : [],
          change24hPct: h ? changePct(h.hourly, 86_400) : null, change7dPct: h ? changePct(h.daily, 7 * 86_400) : null, change30dPct: h ? changePct(h.daily, 30 * 86_400) : null,
          refreshedAt: h ? Math.floor(h.at / 1000) : null
        });
      }
      const hist = url.pathname.match(/^\/v1\/prices\/([1-9A-HJ-NP-Za-km-z]+)$/);
      if (hist) {
        const mintKey = hist[1]!;
        const since = Number(url.searchParams.get("since") ?? Math.floor(Date.now() / 1000) - 7 * 86_400);
        const m = [...live.values()].find((x) => x.market.mint.toBase58() === mintKey);
        const token = m ? Buffer.from(m.market.tokenFeedId).toString("hex") : "";
        const equity = m ? Buffer.from(m.market.equityFeedId).toString("hex") : "";
        return json(200, {
          mint: mintKey,
          mark: store.priceHistory(`mark:${mintKey}`, since).map((p) => [p.publish_time, p.price]),
          token: /^0+$/.test(token) ? [] : store.priceHistory(token, since).map((p) => [p.publish_time, p.price]),
          equity: /^0+$/.test(equity) ? [] : store.priceHistory(equity, since).map((p) => [p.publish_time, p.price]),
          issuerMark: store.priceHistory(`issuer_mark:${mintKey}`, since).map((p) => [p.publish_time, p.price]),
          // Real trade history of the mainnet token behind this market, when it has a reference pool.
          tradeDaily: (() => { const pool = m ? history.get(m.replicaOf ?? mintKey)?.pool.address : undefined; return pool ? store.priceHistory(`gt_day:${pool}`, since).map((p) => [p.publish_time, p.price]) : []; })(),
          tradeHourly: (() => { const pool = m ? history.get(m.replicaOf ?? mintKey)?.pool.address : undefined; return pool ? store.priceHistory(`gt_hour:${pool}`, since).map((p) => [p.publish_time, p.price]) : []; })(),
          basis: store.basisHistory(mintKey, since)
        });
      }
      if (url.pathname === "/v1/vaults") {
        // Every vault's balances and epoch records are live reads; one answer serves every page open for ten seconds,
        // and the vaults are read side by side rather than one after another.
        if (vaultsAnswer && Date.now() - vaultsAnswer.at < 10_000) return json(200, vaultsAnswer.body);
        // A stale answer goes out at once while one refresh runs behind it; only the very first call waits on the RPC.
        if (!vaultsRefreshing) vaultsRefreshing = readVaults().finally(() => { vaultsRefreshing = null; });
        if (vaultsAnswer) { void vaultsRefreshing.catch(() => undefined); return json(200, vaultsAnswer.body); }
        return json(200, await vaultsRefreshing);
      }
      const vbid = url.pathname.match(/^\/v1\/vaults\/([1-9A-HJ-NP-Za-km-z]+)\/bid\/([1-9A-HJ-NP-Za-km-z]+)$/);
      if (vbid) {
        const b = await reader.fetchVaultBid(new PublicKey(vbid[1]!), new PublicKey(vbid[2]!)).catch(() => null);
        return json(200, b ? { series: b.series.toBase58(), bidPerLot: b.bidPerLot.toString(), maxLots6: b.maxLots6.toString(), postedAt: Number(b.postedAt), expiresAt: Number(b.expiresAt) } : null);
      }
      const vpos = url.pathname.match(/^\/v1\/vaults\/([1-9A-HJ-NP-Za-km-z]+)\/position\/([1-9A-HJ-NP-Za-km-z]+)$/);
      if (vpos) {
        const vaultKey = new PublicKey(vpos[1]!);
        const owner = new PublicKey(vpos[2]!);
        const p = await reader.fetchVaultPosition(vaultKey, owner).catch(() => null);
        const vs = [...vaultsLive.values()].flat().find((x) => x.address.equals(vaultKey));
        const { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID } = await import("@solana/spl-token");
        const shareAta = vs ? getAssociatedTokenAddressSync(vs.shareMint, owner, false, TOKEN_2022_PROGRAM_ID) : null;
        const info = shareAta ? await connection.getAccountInfo(shareAta, "confirmed") : null;
        return json(200, { shares: info ? info.data.readBigUInt64LE(64).toString() : "0", queuedDepositRaw: p?.queuedDepositRaw.toString() ?? "0", queuedDepositEpoch: p?.queuedDepositEpoch ?? null, queuedWithdrawShares: p?.queuedWithdrawShares.toString() ?? "0", queuedWithdrawEpoch: p?.queuedWithdrawEpoch ?? null });
      }
      if (url.pathname === "/v1/events") return json(200, store.events({ name: url.searchParams.get("name") ?? undefined, series: url.searchParams.get("series") ?? undefined, wallet: url.searchParams.get("wallet") ?? undefined, limit: Number(url.searchParams.get("limit") ?? 100) }));
      if (url.pathname === "/v1/basis") return json(200, [...live.values()].map((m) => ({ symbol: m.meta.symbol, basisBps: m.basisBps, history: store.basisHistory(m.market.mint.toBase58(), Math.floor(Date.now() / 1000) - 86_400) })));
      json(404, { error: "not found" });
    } catch (e) {
      json(500, { error: (e as Error).message });
    }
  });
  server.on("error", (e) => { console.error(`[services] cannot listen on ${BIND}:${PORT}: ${(e as Error).message}`); process.exit(1); });
  server.listen(PORT, BIND, () => console.log(`[services] http://${BIND}:${PORT}`));

  // Events first: the series index is built from them, and a tick that runs before the first pull would see a market
  // with no series and try to create the ones that already exist. A store still filling its history does not wait:
  // its first tick seeds the index from a scan, and the pull keeps going behind it.
  if (store.getKv("backfill_done")) await pullEvents(); else void pullEvents();
  // A rate-limited RPC can refuse a read in the first pass; the next tick retries, and a crash here would only restart
  // the process into the same first pass.
  await tick().catch((e) => console.error(`[services] first tick failed: ${(e as Error).message}`));
  if (flag("--once")) {
    server.close();
    return;
  }
  setInterval(() => void pullEvents(), Number(process.env.EVENTS_PULL_MS ?? 3_000));
  void refreshHistory();
  setInterval(() => void refreshHistory(), 45_000);
  // One tick at a time: a slow tick (many sends) must not overlap the next, or the keeper and quoter race themselves.
  let inFlight = false;
  setInterval(() => {
    if (inFlight) return;
    inFlight = true;
    tick().catch((e) => console.error(`[services] tick failed: ${(e as Error).message}`)).finally(() => { inFlight = false; });
  }, TICK_MS);
}

/** getMultipleAccountsInfo takes at most 100 keys per call. */
async function inChunks(connection: Connection, keys: PublicKey[]): Promise<(AccountInfo<Buffer> | null)[]> {
  const out: (AccountInfo<Buffer> | null)[] = [];
  for (let i = 0; i < keys.length; i += 100) out.push(...(await connection.getMultipleAccountsInfo(keys.slice(i, i + 100))));
  return out;
}

async function clockUnix(connection: Connection): Promise<number> {
  const info = await connection.getAccountInfo(new PublicKey("SysvarC1ock11111111111111111111111111111111"));
  return info ? Number(info.data.readBigInt64LE(32)) : Math.floor(Date.now() / 1000);
}

main().catch((e) => { console.error(e); process.exit(1); });
