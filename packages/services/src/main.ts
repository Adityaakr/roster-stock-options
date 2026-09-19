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
import { readFileSync } from "node:fs";
import { Connection, Keypair, PublicKey, type AccountInfo } from "@solana/web3.js";
import * as anchorNs from "@anchor-lang/core";
import { RosterClient, ROSTER_PROGRAM_ID, type MarketState } from "@roster/sdk";
import { Hermes, HermesError, estimateVol, readMultiplier, sessionAt } from "@roster/oracle";
import { Indexer, SqliteStore, type MarketMeta } from "@roster/indexer";
import { Quoter, DEFAULT_QUOTER } from "@roster/quoter";
import { Keeper, DEFAULT_KEEPER } from "@roster/keeper";
import { mapLimit } from "@roster/core";
import { issuerMark, jupiterPrice, launchSet, refreshSnapshots, snapshotOf, snapshotPrice, xstocksQuote } from "./registry";

const anchor = ((anchorNs as { default?: unknown }).default ?? anchorNs) as typeof anchorNs;
const args = new Set(process.argv.slice(2));
const flag = (name: string) => args.has(name);
const RPC = process.env.FORK_RPC_URL ?? process.env.RPC_URL ?? "http://127.0.0.1:8899";
const PORT = Number(process.env.SERVICES_PORT ?? 8787);
const TICK_MS = Number(process.env.SERVICES_TICK_MS ?? 15_000);
/* Markets priced and cranked at once. A tick that walks four hundred markets one at a time is a tick that settles a
 * Friday's expiries minutes late; each market's accounts are disjoint, so the pass fans out. */
const MARKET_CONCURRENCY = Number(process.env.SERVICES_MARKET_CONCURRENCY ?? 4);

function key(path: string): Keypair {
  return Keypair.fromSecretKey(new Uint8Array(JSON.parse(readFileSync(path, "utf8"))));
}

interface MarketLive {
  market: MarketState;
  meta: MarketMeta;
  price: number | null;
  priceAt: number;
  priceSource: "hermes" | "reference" | "tokens.xyz" | "xstocks" | "jupiter" | "tessera" | "prestocks" | "none";
  /** From the Tokens API snapshot where one exists: a real 24 hour change and holder count before this cluster has a price history of its own. */
  change24hPct: number | null;
  holders: number | null;
  /** Devnet only: the mainnet mint this market's token replicates, and takes its price from. */
  replicaOf: string | null;
  wrapper: "xStock" | "Ondo" | "Tessera" | "PreStocks";
  feeBps: number;
  equityPrice: number | null;
  basisBps: number | null;
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
  const connection = new Connection(RPC, "confirmed");
  const genesis = await connection.getGenesisHash();
  const isFork = RPC.includes("127.0.0.1") || RPC.includes("localhost");
  // Devnet is a real cluster with replica mints (docs/DEVNET.md): the same code, priced from each replica's mainnet
  // counterpart, and with every screen saying which cluster it is on.
  const isDevnet = !isFork && (RPC.includes("devnet") || process.env.NEXT_PUBLIC_CLUSTER === "devnet");
  const cluster = isFork ? "fork" : isDevnet ? "devnet" : process.env.NEXT_PUBLIC_CLUSTER ?? "mainnet";
  const deployer = key(process.env.DEPLOYER_KEYPAIR ?? ".keys/deployer.json");
  const quoterKey = key(process.env.QUOTER_KEYPAIR ?? ".keys/quoter.json");
  const keeperKey = key(process.env.KEEPER_KEYPAIR ?? ".keys/keeper.json");
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
   * program-wide scan: Alchemy's free tier, which is what a devnet deployment runs on, refuses getProgramAccounts.
   * A series the store has not seen yet is picked up on the next events pull, seconds later.
   */
  for (const client of [reader, quoterClient, keeperClient]) {
    client.seriesIndex = (market) => store.knownSeries(market.toBase58()).map((a) => new PublicKey(a));
  }
  // QUOTER_LOTS_PER_SERIES caps the treasury's ask per series (docs/SEEDING.md sets it for the first mainnet week).
  const quoter = new Quoter(quoterClient, { ...DEFAULT_QUOTER, lotsPerSeries: BigInt(Math.round(Number(process.env.QUOTER_LOTS_PER_SERIES ?? 50) * 1e6)) });
  const keeper = new Keeper(keeperClient, deployer.publicKey, DEFAULT_KEEPER);
  const live = new Map<string, MarketLive>();
  let lastTick = 0;
  let blocked: string | null = null;
  // Realised vol per symbol, refreshed hourly: Benchmarks is a slow, keyed endpoint and vol does not move per tick.
  const volCache = new Map<string, { at: number; v: Awaited<ReturnType<typeof estimateVol>> }>();
  async function volFor(symbol: string) {
    const hit = volCache.get(symbol);
    if (hit && Date.now() - hit.at < 3_600_000) return hit.v;
    const v = await estimateVol(`Crypto.${symbol.toUpperCase()}/USD`, Number(process.env.VOL_FLOOR ?? 0.35), process.env.PYTH_CORE_API_KEY);
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
   * token (Tessera, PreStocks), then the Tokens API snapshot, then Jupiter's routed price, then the xStocks quote.
   * A devnet replica is priced from `replicaOf`, the mainnet mint it stands in for, so its screen shows the market's
   * numbers and not an invention. Routed and snapshot prices are per token, so the multiplier converts them.
   */
  async function markFor(l: (typeof launch)[number], multiplier: number): Promise<{ price: number; source: MarketLive["priceSource"] } | null> {
    const ref = process.env[`REFERENCE_PRICE_${l.symbol.toUpperCase()}`];
    if (ref && Number(ref) > 0) return { price: Number(ref), source: "reference" };
    const im = await issuerMark(l);
    if (im) return { price: im.price, source: im.source };
    const priced = l.replicaOf ?? l.mint.toBase58();
    const snap = snapshotPrice(priced);
    if (snap) return { price: snap / (multiplier || 1), source: "tokens.xyz" };
    const routed = await jupiterPrice(priced).catch(() => null);
    if (routed) return { price: routed / (multiplier || 1), source: "jupiter" };
    const quote = (await xstocksQuote(l.symbol).catch(() => null)) ?? (l.underlyingSymbol ? await xstocksQuote(`${l.underlyingSymbol}x`).catch(() => null) : null);
    return quote ? { price: quote, source: "xstocks" } : null;
  }

  async function tick(): Promise<void> {
    const nowTs = await clockUnix(connection);
    // One batched snapshot call for every market, cached for a minute inside the registry module.
    await refreshSnapshots(launch.map((l) => l.replicaOf ?? l.mint.toBase58()));
    await mapLimit(launch, MARKET_CONCURRENCY, async (l) => {
      const market = await reader.fetchMarket(l.mint);
      if (!market) return;
      const feedId = Buffer.from(market.tokenFeedId).toString("hex");
      const equityFeed = Buffer.from(market.equityFeedId).toString("hex");
      // The multiplier is read first: a routed price is per token, and the display strike divides by it.
      const mult = await readMultiplier(connection, l.symbol, l.mint, nowTs);
      let price: number | null = null;
      let equityPrice: number | null = null;
      let priceAt = 0;
      let priceSource: MarketLive["priceSource"] = "none";
      const noFeed = /^0+$/.test(feedId);
      if (noFeed) {
        // No Pyth feed for this wrapper, which is every market while the key's grant excludes them: the issuer's own
        // mark, the Tokens API snapshot and the routed price are the sources, in that order, on every cluster.
        const m = await markFor(l, mult.onChain);
        if (m) { price = m.price; priceAt = nowTs; priceSource = m.source; } else console.warn(`[oracle] ${l.symbol}: no mark from any source`);
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
      const vol = await volFor(l.symbol);
      const session = sessionAt(nowTs);
      const basisBps = price !== null && equityPrice !== null && session === "regular" ? ((price - equityPrice) / equityPrice) * 10_000 : null;
      if (basisBps !== null) store.recordBasis(l.mint.toBase58(), basisBps, nowTs);
      const paused = await keeper.mintPaused(market.mint, market.tokenProgram);
      const snap = snapshotOf(l.replicaOf ?? l.mint.toBase58());
      const state: MarketLive = { change24hPct: snap?.change24hPct ?? null, holders: snap?.holders ?? null, replicaOf: l.replicaOf, market, meta: meta.get(l.mint.toBase58())!, price, priceAt, priceSource, wrapper: l.wrapper, feeBps: l.feeBps, equityPrice, basisBps, multiplier: mult.onChain, pendingDividendMultiplier: mult.pendingMultiplier !== null && mult.pendingIsDividend && mult.pendingAt !== null && market.allowedExpiries.some((e) => e > BigInt(mult.pendingAt!)) ? mult.pendingMultiplier : null, pendingActivationTs: mult.pendingAt, inActivationWindow: mult.inWindow, vol: vol.blended, volSource: vol.source, session, paused };
      live.set(l.symbol, state);
      if (!flag("--no-keeper")) {
        await keeper.rollGrid(market, nowTs, (process.env.EXTRA_EXPIRIES ?? "").split(",").filter(Boolean).map(BigInt));
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
      const canQuote = priceSource === "hermes" || priceSource === "tessera" || priceSource === "prestocks" || (testCluster && priceSource !== "none");
      const volOk = vol.source !== "floor" || testCluster || process.env.VOL_FLOOR_OK === "1";
      if (!flag("--no-quoter")) {
        if (price === null || !canQuote || !volOk) {
          await quoter.pullQuotes(market, l.symbol, nowTs, price === null ? "no price" : !canQuote ? "no oracle or issuer price on this cluster" : "volatility fell back to the floor");
        } else {
        const fresh = (await reader.fetchMarket(l.mint)) ?? market;
        // Price age against the wall clock: the chain clock can be time-travelled on a fork, publish times cannot.
        const ageSecs = priceSource === "hermes" ? Math.max(0, Math.floor(Date.now() / 1000) - priceAt) : 0;
        await quoter.cycle({ market: fresh, symbol: l.symbol, tier: l.tier, feeBps: l.feeBps, graceSecs: Number((await reader.fetchProtocol()).graceSecs), price, priceAgeSecs: ageSecs, equityPrice, multiplier: mult.onChain, pendingDividendMultiplier: state.pendingDividendMultiplier, inActivationWindow: mult.inWindow, vol: vol.blended, nowTs });
        }
      }
      await indexer.snapshotMarket((await reader.fetchMarket(l.mint)) ?? market);
    });
    await pullEvents();
    lastTick = Date.now();
    if (blocked) console.warn(`[services] blocked on ${blocked}: the quoter cannot price (docs/OPERATOR.md)`);
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const json = (code: number, body: unknown) => { res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*" }); res.end(JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v))); };
    try {
      if (url.pathname === "/v1/health") return json(200, { ok: true, cluster, lastTick, blocked, tickMs: TICK_MS, program: ROSTER_PROGRAM_ID.toBase58(), hermesKeyed: hermes.keyed });
      if (url.pathname === "/v1/roster") {
        const nowTs = await clockUnix(connection);
        const wall = Math.floor(Date.now() / 1000);
        const markets = [...live.values()].map((m) => ({ symbol: m.meta.symbol, name: m.meta.name, wrapper: m.wrapper, feeBps: m.feeBps, mint: m.market.mint.toBase58(), sparkline: store.priceHistory(`mark:${m.market.mint.toBase58()}`, wall - 86_400).map((p) => [p.publish_time, p.price] as [number, number]).filter((_, i, a) => i % Math.max(1, Math.floor(a.length / 120)) === 0), market: m.market.address.toBase58(), decimals: m.market.decimals, tier: m.market.tier, listed: m.market.listed, paused: m.market.paused || m.paused, hasTransferFee: m.market.hasTransferFee, hasPermanentDelegate: m.market.hasPermanentDelegate, pausable: m.market.pausable, hookProgram: m.market.hookProgram.toBase58(), allowedExpiries: m.market.allowedExpiries.map(String), strikeStep: m.market.strikeStep.toString(), minLots6: m.market.minLots6.toString(), maxLots6: m.market.maxLots6.toString(), maxLiveSeries: m.market.maxLiveSeries, liveSeries: m.market.liveSeries, price: m.price, priceAt: m.priceAt, priceSource: m.priceSource, change24hPct: m.change24hPct, holders: m.holders, replicaOf: m.replicaOf, equityPrice: m.equityPrice, basisBps: m.basisBps, multiplier: m.multiplier, pendingActivationTs: m.pendingActivationTs, inActivationWindow: m.inActivationWindow, vol: m.vol, volSource: m.volSource, series: store.series(m.market.address.toBase58()).map((s) => ({ ...s, asks: JSON.parse(s.asks_json), writers: JSON.parse(s.writers_json), asks_json: undefined, writers_json: undefined })) }));
        const protocol = await reader.fetchProtocol().catch(() => null);
        return json(200, { cluster, programDeployed: true, program: ROSTER_PROGRAM_ID.toBase58(), nowTs, session: sessionAt(nowTs), feeBps: protocol?.feeBps ?? null, keeperFeeUsdc: protocol?.keeperFeeUsdc.toString() ?? null, graceSecs: protocol?.graceSecs.toString() ?? null, treasury: protocol?.treasury.toBase58() ?? null, quoter: quoterClient.wallet.toBase58(), blocked, hermesKeyed: hermes.keyed, markets, quoterLog: quoter.log.slice(-40), keeperLog: keeper.log.slice(-40) });
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
          basis: store.basisHistory(mintKey, since)
        });
      }
      if (url.pathname === "/v1/events") return json(200, store.events({ name: url.searchParams.get("name") ?? undefined, series: url.searchParams.get("series") ?? undefined, limit: Number(url.searchParams.get("limit") ?? 100) }));
      if (url.pathname === "/v1/basis") return json(200, [...live.values()].map((m) => ({ symbol: m.meta.symbol, basisBps: m.basisBps, history: store.basisHistory(m.market.mint.toBase58(), Math.floor(Date.now() / 1000) - 86_400) })));
      json(404, { error: "not found" });
    } catch (e) {
      json(500, { error: (e as Error).message });
    }
  });
  server.on("error", (e) => { console.error(`[services] cannot listen on ${PORT}: ${(e as Error).message}`); process.exit(1); });
  server.listen(PORT, "127.0.0.1", () => console.log(`[services] http://127.0.0.1:${PORT}`));

  // Events first: the series index is built from them, and a tick that runs before the first pull would see a market
  // with no series and try to create the ones that already exist.
  await pullEvents();
  await tick();
  if (flag("--once")) {
    server.close();
    return;
  }
  setInterval(() => void pullEvents(), Number(process.env.EVENTS_PULL_MS ?? 3_000));
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
