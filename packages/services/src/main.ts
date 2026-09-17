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
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import * as anchorNs from "@anchor-lang/core";
import { RosterClient, ROSTER_PROGRAM_ID, type MarketState } from "@roster/sdk";
import { Hermes, HermesError, estimateVol, readMultiplier, sessionAt } from "@roster/oracle";
import { Indexer, SqliteStore, type MarketMeta } from "@roster/indexer";
import { Quoter, DEFAULT_QUOTER } from "@roster/quoter";
import { Keeper, DEFAULT_KEEPER } from "@roster/keeper";
import { issuerMark, launchSet, xstocksQuote } from "./registry";

const anchor = ((anchorNs as { default?: unknown }).default ?? anchorNs) as typeof anchorNs;
const args = new Set(process.argv.slice(2));
const flag = (name: string) => args.has(name);
const RPC = process.env.FORK_RPC_URL ?? process.env.RPC_URL ?? "http://127.0.0.1:8899";
const PORT = Number(process.env.SERVICES_PORT ?? 8787);
const TICK_MS = Number(process.env.SERVICES_TICK_MS ?? 15_000);

function key(path: string): Keypair {
  return Keypair.fromSecretKey(new Uint8Array(JSON.parse(readFileSync(path, "utf8"))));
}

interface MarketLive {
  market: MarketState;
  meta: MarketMeta;
  price: number | null;
  priceAt: number;
  priceSource: "hermes" | "reference" | "xstocks" | "tessera" | "prestocks" | "none";
  wrapper: "xStock" | "Tessera" | "PreStocks";
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
  const cluster = isFork ? "fork" : process.env.NEXT_PUBLIC_CLUSTER ?? "mainnet";
  const deployer = key(process.env.DEPLOYER_KEYPAIR ?? ".keys/deployer.json");
  const quoterKey = key(process.env.QUOTER_KEYPAIR ?? ".keys/quoter.json");
  const keeperKey = key(process.env.KEEPER_KEYPAIR ?? ".keys/keeper.json");
  const reader = new RosterClient(connection, new anchor.Wallet(deployer));
  const quoterClient = new RosterClient(connection, new anchor.Wallet(quoterKey));
  const keeperClient = new RosterClient(connection, new anchor.Wallet(isFork ? deployer : keeperKey));
  const hermes = new Hermes(process.env.PYTH_CORE_API_KEY);
  const store = new SqliteStore(process.env.INDEXER_DB ?? (isFork ? ".keys/indexer-fork.sqlite" : ".keys/indexer.sqlite"));
  const launch = await launchSet();
  const meta = new Map<string, MarketMeta>(launch.map((l) => [l.mint.toBase58(), { mint: l.mint.toBase58(), symbol: l.symbol, name: l.name }]));
  const indexer = new Indexer(connection, reader, store, meta);
  const quoter = new Quoter(quoterClient, DEFAULT_QUOTER);
  const keeper = new Keeper(keeperClient, deployer.publicKey, DEFAULT_KEEPER);
  const live = new Map<string, MarketLive>();
  let lastTick = 0;
  let blocked: string | null = null;
  console.log(`[services] cluster=${cluster} genesis=${genesis.slice(0, 8)} program=${ROSTER_PROGRAM_ID.toBase58()} hermes=${hermes.keyed ? "keyed" : "NO KEY"} markets=${launch.map((l) => l.symbol).join(",")}`);

  // Events are pulled on their own short loop as well as at the end of each tick: a tick that reprices every series
  // can take a minute, and a receipt should not wait for it.
  let pulling = false;
  async function pullEvents(): Promise<void> {
    if (pulling) return;
    pulling = true;
    try {
      await indexer.pullEvents();
    } catch (e) {
      console.warn(`[indexer] events: ${(e as Error).message}`);
    } finally {
      pulling = false;
    }
  }

  async function tick(): Promise<void> {
    const nowTs = await clockUnix(connection);
    for (const l of launch) {
      const market = await reader.fetchMarket(l.mint);
      if (!market) continue;
      const feedId = Buffer.from(market.tokenFeedId).toString("hex");
      const equityFeed = Buffer.from(market.equityFeedId).toString("hex");
      let price: number | null = null;
      let equityPrice: number | null = null;
      let priceAt = 0;
      let priceSource: MarketLive["priceSource"] = "none";
      const noFeed = /^0+$/.test(feedId);
      if (noFeed) {
        // No Pyth feed exists for this wrapper: the issuer's mark is the price source, on every cluster.
        const im = await issuerMark(l);
        if (im) { price = im.price; priceAt = nowTs; priceSource = im.source; } else console.warn(`[oracle] ${l.symbol}: issuer mark unavailable`);
      } else {
        try {
          const samples = await hermes.latest([feedId, equityFeed].filter((f) => !/^0+$/.test(f)));
          const t = samples.get(feedId);
          if (t) { price = t.price; priceAt = t.publishTime; priceSource = "hermes"; store.recordPrice({ feed_id: feedId, price: t.price, conf: t.conf, publish_time: t.publishTime }); }
          const e = samples.get(equityFeed);
          if (e) { equityPrice = e.price; store.recordPrice({ feed_id: equityFeed, price: e.price, conf: e.conf, publish_time: e.publishTime }); }
          blocked = null;
        } catch (err) {
          // Without a Pyth key the issuer's own quote stands in: on the fork the quoter may price off it (a test device,
          // refused elsewhere by the loopback rule); on a real cluster it is a display mark only and the quoter stays blocked.
          const ref = process.env[`REFERENCE_PRICE_${l.symbol.toUpperCase()}`];
          const issuer = ref ? Number(ref) : await xstocksQuote(l.symbol).catch(() => null);
          if (issuer) { price = issuer; priceAt = nowTs; priceSource = ref ? "reference" : "xstocks"; }
          if (err instanceof HermesError && err.status === 401) blocked = "PYTH_CORE_API_KEY";
          else console.warn(`[oracle] ${l.symbol}: ${(err as Error).message}`);
        }
      }
      const mult = await readMultiplier(connection, l.symbol, l.mint, nowTs);
      const vol = await estimateVol(`Crypto.${l.symbol.toUpperCase()}/USD`, Number(process.env.VOL_FLOOR ?? 0.35), process.env.PYTH_CORE_API_KEY);
      const session = sessionAt(nowTs);
      const basisBps = price !== null && equityPrice !== null && session === "regular" ? ((price - equityPrice) / equityPrice) * 10_000 : null;
      if (basisBps !== null) store.recordBasis(l.mint.toBase58(), basisBps, nowTs);
      const paused = await keeper.mintPaused(market.mint, market.tokenProgram);
      const state: MarketLive = { market, meta: meta.get(l.mint.toBase58())!, price, priceAt, priceSource, wrapper: l.wrapper, feeBps: l.feeBps, equityPrice, basisBps, multiplier: mult.onChain, pendingDividendMultiplier: mult.pendingMultiplier !== null && mult.pendingIsDividend && mult.pendingAt !== null && market.allowedExpiries.some((e) => e > BigInt(mult.pendingAt!)) ? mult.pendingMultiplier : null, pendingActivationTs: mult.pendingAt, inActivationWindow: mult.inWindow, vol: vol.blended, volSource: vol.source, session, paused };
      live.set(l.symbol, state);
      if (!flag("--no-keeper")) {
        await keeper.rollGrid(market, nowTs, (process.env.EXTRA_EXPIRIES ?? "").split(",").filter(Boolean).map(BigInt));
        await keeper.cycle(await reader.fetchMarket(l.mint) ?? market, nowTs, paused);
      }
      // The quoter prices only off Hermes, or off the issuer quote on the fork; a real cluster without a key does not quote.
      const canQuote = priceSource === "hermes" || priceSource === "tessera" || priceSource === "prestocks" || (isFork && priceSource !== "none");
      if (!flag("--no-quoter") && price !== null && canQuote) {
        const fresh = (await reader.fetchMarket(l.mint)) ?? market;
        await quoter.cycle({ market: fresh, symbol: l.symbol, tier: l.tier, feeBps: l.feeBps, price, priceAgeSecs: Math.max(0, nowTs - priceAt), equityPrice, multiplier: mult.onChain, pendingDividendMultiplier: state.pendingDividendMultiplier, inActivationWindow: mult.inWindow, vol: vol.blended, nowTs });
      }
      await indexer.snapshotMarket((await reader.fetchMarket(l.mint)) ?? market);
    }
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
        const markets = [...live.values()].map((m) => ({ symbol: m.meta.symbol, name: m.meta.name, wrapper: m.wrapper, feeBps: m.feeBps, mint: m.market.mint.toBase58(), market: m.market.address.toBase58(), decimals: m.market.decimals, tier: m.market.tier, listed: m.market.listed, paused: m.market.paused || m.paused, hasTransferFee: m.market.hasTransferFee, hasPermanentDelegate: m.market.hasPermanentDelegate, pausable: m.market.pausable, hookProgram: m.market.hookProgram.toBase58(), allowedExpiries: m.market.allowedExpiries.map(String), strikeStep: m.market.strikeStep.toString(), minLots6: m.market.minLots6.toString(), maxLots6: m.market.maxLots6.toString(), maxLiveSeries: m.market.maxLiveSeries, liveSeries: m.market.liveSeries, price: m.price, priceAt: m.priceAt, priceSource: m.priceSource, equityPrice: m.equityPrice, basisBps: m.basisBps, multiplier: m.multiplier, pendingActivationTs: m.pendingActivationTs, inActivationWindow: m.inActivationWindow, vol: m.vol, volSource: m.volSource, series: store.series(m.market.address.toBase58()).map((s) => ({ ...s, asks: JSON.parse(s.asks_json), writers: JSON.parse(s.writers_json), asks_json: undefined, writers_json: undefined })) }));
        const protocol = await reader.fetchProtocol().catch(() => null);
        return json(200, { cluster, programDeployed: true, program: ROSTER_PROGRAM_ID.toBase58(), nowTs, session: sessionAt(nowTs), feeBps: protocol?.feeBps ?? null, keeperFeeUsdc: protocol?.keeperFeeUsdc.toString() ?? null, graceSecs: protocol?.graceSecs.toString() ?? null, treasury: protocol?.treasury.toBase58() ?? null, quoter: quoterKey.publicKey.toBase58(), blocked, markets, quoterLog: quoter.log.slice(-40), keeperLog: keeper.log.slice(-40) });
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
        const { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID } = await import("@solana/spl-token");
        const { autoExercisePda } = await import("@roster/sdk");
        const rows = store.series();
        // One RPC round trip for every position ATA, then one for the opt-ins of the positions that exist.
        const atas = rows.map((row) => getAssociatedTokenAddressSync(new PublicKey(row.position_mint), wallet, false, TOKEN_2022_PROGRAM_ID));
        const infos = atas.length ? await connection.getMultipleAccountsInfo(atas) : [];
        const held = rows.map((row, i) => ({ row, amount: infos[i] ? infos[i]!.data.readBigUInt64LE(64) : 0n })).filter((x) => x.amount > 0n);
        const optIns = held.length ? await connection.getMultipleAccountsInfo(held.map((x) => autoExercisePda(ROSTER_PROGRAM_ID, wallet, new PublicKey(x.row.address)))) : [];
        const out = held.map((x, i) => ({ series: x.row.address, market: x.row.market, side: x.row.side, strike_usdc_per_lot: x.row.strike_usdc_per_lot, expiry_ts: x.row.expiry_ts, position_mint: x.row.position_mint, lots6: x.amount.toString(), autoExercise: !!optIns[i] }));
        return json(200, { wallet: wallet.toBase58(), positions: out, events: store.events({ wallet: wallet.toBase58(), limit: 100 }) });
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

async function clockUnix(connection: Connection): Promise<number> {
  const info = await connection.getAccountInfo(new PublicKey("SysvarC1ock11111111111111111111111111111111"));
  return info ? Number(info.data.readBigInt64LE(32)) : Math.floor(Date.now() / 1000);
}

main().catch((e) => { console.error(e); process.exit(1); });
