import "./env-load";
/*
 * List the registry's eligible markets on the fork (M5): `create_market` per mint with its tier, feeds and grid, then
 * the escrow proof the registry requires before a listing counts: create a series at the nearest expiry, quote one
 * lot into the vault from the deployer wallet, withdraw it. Signatures are written back to registry.json.
 * Idempotent: existing markets get their expiries rolled, proven mints keep their proof.
 */
import { writeFileSync } from "node:fs";
import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import * as anchorNs from "@anchor-lang/core";
import { RosterClient } from "../packages/sdk/src";
import { nextExpiries } from "../packages/core/src";
import { jupiterPrice, readRegistry, registryPathFor, xstocksQuote, REGISTRY_PATH, type RegistryEntry } from "../packages/registry/src";
import { FORK_URL, USDC_MINT, clockUnix, fundSol, fundToken, loadOrCreateKey, onChainMultiplier, tokenProgramFor } from "./fork-lib";
import { DEVNET_RPC, devnetMints, mintToOwner, quoteMintOf } from "./devnet-lib";

const anchor = ((anchorNs as { default?: unknown }).default ?? anchorNs) as typeof anchorNs;
const LOT = 1_000_000n;
const USDC = 1_000_000n;
const args = new Set(process.argv.slice(2));
/* Devnet lists replica mints against a quote mint we control (docs/DEVNET.md); everything downstream is the same code. */
const DEVNET = args.has("--devnet");
const RPC = DEVNET ? DEVNET_RPC : process.env.RPC_URL ?? FORK_URL;
const REGISTRY = DEVNET ? registryPathFor("devnet") : REGISTRY_PATH;
const MINTS = DEVNET ? devnetMints() : null;
const QUOTE = MINTS ? quoteMintOf(MINTS) : { mint: USDC_MINT, program: TOKEN_PROGRAM_ID, decimals: 6 };

/** Per-tier grid and caps (Part 2 section 2): the treasury quotes Tier 1 both sides at three sizes, Tier 2 the nearest expiry. */
function marketParams(tier: number, quote: number) {
  const step = quote >= 500 ? 5n : quote >= 100 ? 1n : 1n;
  const lo = BigInt(Math.max(1, Math.floor((quote * 0.5) / Number(step)))) * step;
  const hi = BigInt(Math.ceil((quote * 1.5) / Number(step))) * step;
  return {
    strikeStep: step * USDC,
    minStrike: lo * USDC,
    maxStrike: hi * USDC,
    // (expiries quoted + 1) x 3 strikes x 2 sides: an expired grid keeps its slots until close, one grace after expiry,
    // so the next expiry needs room while the old one waits (feedback finding, docs/BUILD_LOG.md M8.1).
    // Each live series costs about 0.045 SOL of rent (docs/RENT.md), reclaimed at close. Devnet runs on a faucet
    // balance, so its caps are the smallest that still show both sides at two expiries.
    maxLiveSeries: DEVNET ? (tier === 1 ? 4 : 2) : tier === 1 ? 18 : tier === 2 ? 12 : 6,
    minLots6: LOT / 100n,
    maxLots6: (tier === 1 ? 10_000n : 2_000n) * LOT,
    maxWriterLots6: (tier === 1 ? 5_000n : 1_000n) * LOT
  };
}

async function main() {
  const registry = readRegistry(REGISTRY);
  if (!registry) throw new Error(`${REGISTRY} missing: run ${DEVNET ? "pnpm devnet:registry" : "pnpm registry"} first`);
  const connection = new Connection(RPC, "confirmed");
  const deployer = loadOrCreateKey("deployer");
  const keeper = loadOrCreateKey("keeper");
  const quoter = loadOrCreateKey("quoter");
  if (!DEVNET) {
    await fundSol(deployer.publicKey, 100e9);
    await fundSol(quoter.publicKey, 100e9);
  }
  const c = new RosterClient(connection, new anchor.Wallet(deployer));
  if (!(await connection.getAccountInfo(c.protocol))) {
    await c.send(await c.initProtocol(QUOTE.mint, { pauseAuthority: keeper.publicKey, treasury: deployer.publicKey, feeBps: 10, integratorShareBps: 3000, keeperFeeUsdc: 2n * USDC, graceSecs: 3600n }));
    console.log("protocol initialised");
  }
  const now = await clockUnix(connection);
  const expiries = nextExpiries(now, 2).map(BigInt);
  // The quoter wallet creates series on Tier 1 and 2 markets (the program limits creation there to the authority and
  // the series creator; Tier 3 is open).
  const protocol = await c.fetchProtocol();
  if (!protocol.seriesCreator.equals(quoter.publicKey)) await c.send(await c.updateProtocol({ seriesCreator: quoter.publicKey }));
  const only = [...args].filter((a) => !a.startsWith("--"));
  for (const e of registry.entries) {
    if (only.length && !only.includes(e.symbol)) continue;
    const ok = e.inspection.verdict === "eligible" || e.inspection.verdict === "eligible_with_fee";
    if (!ok || (!e.feeds.tokenFeed && !e.issuerMark)) {
      console.log(`${e.symbol}: ${e.inspection.verdict}${e.feeds.tokenFeed || e.issuerMark ? "" : ", no token feed and no issuer mark"}; not listed`);
      continue;
    }
    if (e.tier === 3 && !args.has("--tier3")) continue;
    try {
      await listOne(connection, c, e, expiries, quoter.publicKey);
    } catch (err) {
      console.error(`${e.symbol}: ${(err as Error).message.split("\n")[0]}`);
    }
  }
  writeFileSync(REGISTRY, JSON.stringify(registry, null, 2));
  console.log(`registry updated: ${registry.entries.filter((x) => x.escrowProof).length} proven`);
}

async function listOne(connection: Connection, c: RosterClient, e: RegistryEntry, expiries: bigint[], quoterKey: PublicKey): Promise<void> {
  const mint = new PublicKey(e.mint);
  // Strikes are per lot (one raw token); an issuer quotes per UI share, and a ScaledUiAmount mint shows one token as
  // `multiplier` shares, so the grid is sized off the per-lot forward. Jupiter's routed price is already per token.
  const mult = await onChainMultiplier(connection, mint).catch(() => 1);
  const issuerPerShare = e.issuerMark
    ? (e.issuerMark.tokenPrice ?? e.issuerMark.markPrice)
    : (await xstocksQuote(e.symbol).catch(() => null)) ?? (e.underlyingSymbol ? await xstocksQuote(`${e.underlyingSymbol}x`).catch(() => null) : null);
  const quote = issuerPerShare !== null && issuerPerShare !== undefined ? issuerPerShare * mult : await jupiterPrice(e.mint).catch(() => null);
  if (!quote) throw new Error("no issuer quote or routed price to size the grid");
  const p = marketParams(e.tier, quote);
  let m = await c.fetchMarket(mint);
  if (!m) {
    await c.send(await c.createMarket({ mint, tokenFeedId: e.feeds.tokenFeed ? Buffer.from(e.feeds.tokenFeed.id, "hex") : new Uint8Array(32), equityFeedId: e.feeds.equityFeed ? Buffer.from(e.feeds.equityFeed.id, "hex") : new Uint8Array(32), allowedExpiries: expiries, ...p, tier: e.tier, maxPriceAgeSecs: 60, maxConfBps: 100, symbol: e.symbol, feedPricesUiShare: true }));
    m = (await c.fetchMarket(mint))!;
    console.log(`${e.symbol}: market created (tier ${e.tier}, step ${Number(p.strikeStep) / 1e6}, ${Number(p.minStrike) / 1e6}..${Number(p.maxStrike) / 1e6})`);
  } else {
    // Keep the grid where the price is: expiries roll, and the strike bounds follow the per-lot forward.
    const gridMoved = m.strikeStep !== p.strikeStep || m.minStrike !== p.minStrike || m.maxStrike !== p.maxStrike || m.maxLiveSeries !== p.maxLiveSeries;
    await c.send(await c.updateMarket(mint, { allowedExpiries: expiries, ...(gridMoved ? { strikeStep: p.strikeStep, minStrike: p.minStrike, maxStrike: p.maxStrike, maxLiveSeries: p.maxLiveSeries } : {}) }));
    if (gridMoved) console.log(`${e.symbol}: grid moved to step ${Number(p.strikeStep) / 1e6}, ${Number(p.minStrike) / 1e6}..${Number(p.maxStrike) / 1e6} (per lot, multiplier ${mult.toFixed(4)})`);
  }
  if (e.escrowProof) {
    console.log(`${e.symbol}: escrow already proven ${e.escrowProof.provenAt}`);
    return;
  }
  // The proof: a real deposit into the series vault and back, through the same instructions a writer uses.
  const decimals = e.inspection.decimals;
  const lot = 10n ** BigInt(decimals);
  const program = tokenProgramFor(m.tokenProgram);
  const payer = c.provider.wallet.payer!;
  if (DEVNET) {
    await mintToOwner(connection, payer, mint, program, payer.publicKey, 10n * lot);
    await mintToOwner(connection, payer, QUOTE.mint, QUOTE.program, payer.publicKey, 10_000n * USDC);
  } else {
    await fundToken(connection, payer, mint, program, 10n * lot);
    await fundToken(connection, payer, USDC_MINT, TOKEN_PROGRAM_ID, 10_000n * USDC);
  }
  const strike = BigInt(Math.round(quote / (Number(p.strikeStep) / 1e6))) * p.strikeStep;
  const clamped = strike < p.minStrike ? p.minStrike : strike > p.maxStrike ? p.maxStrike : strike;
  // A market at its live-series cap (the quoter fills the grid) proves the escrow on one of its live call series.
  const now = BigInt(await clockUnix(connection));
  let series: PublicKey;
  if (m.liveSeries >= m.maxLiveSeries) {
    const live = (await c.fetchSeriesForMarket(m.address)).find((x) => x.side === "call" && x.expiryTs > now && !x.halted);
    if (!live) throw new Error("live series cap reached and no live call series to prove on");
    series = live.address;
  } else {
    const created = await c.createSeries(m, "call", clamped, expiries[0]!);
    series = created.series;
    if (!(await connection.getAccountInfo(series))) await c.send(created.tx);
  }
  const me = c.wallet;
  // A transfer-fee mint delivers less than sent: the vault credits what arrived, so the ask stays under one lot.
  const feeBps = BigInt(e.inspection.transferFee?.bps ?? 0);
  const askLots = feeBps > 0n ? ((LOT * (10_000n - feeBps)) / 10_000n / 10_000n) * 10_000n - 10_000n : LOT;
  const quoteSig = await c.send(await c.quote(m, (await c.fetchSeries(series))!, LOT, askLots, 1_000_000n));
  const after = (await c.fetchSeries(series))!;
  const mySlot = after.writers.findIndex((w) => w.writer.equals(me));
  for (const a of after.asks.filter((a) => a.writerSlot === mySlot)) await c.send(await c.cancelAsk(after, a.seq));
  const slot = (await c.fetchSeries(series))!.writers[mySlot]!;
  const free = slot.depositedLots6 - slot.withdrawnLots6 - slot.openLots6 - slot.assignedLots6;
  const withdrawSig = await c.send(await c.withdrawUnsold(m, (await c.fetchSeries(series))!, free));
  if (feeBps > 0n) console.log(`${e.symbol}: fee mint, deposited 1 lot, vault credited ${Number(slot.depositedLots6) / 1e6} lots, withdrew ${Number(free) / 1e6}`);
  e.escrowProof = { series: series.toBase58(), quote: quoteSig, withdraw: withdrawSig, provenAt: new Date().toISOString() };
  console.log(`${e.symbol}: escrow proven (quote ${quoteSig.slice(0, 8)}…, withdraw ${withdrawSig.slice(0, 8)}…) on series ${series.toBase58().slice(0, 8)}…`);
  void program; void TOKEN_2022_PROGRAM_ID; void quoterKey;
}

main().catch((e) => { console.error(e); process.exit(1); });
