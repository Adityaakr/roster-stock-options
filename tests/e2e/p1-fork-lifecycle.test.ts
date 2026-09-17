import "../../scripts/env-load";
/*
 * P1 on the fork: the same lifecycle as the litesvm suite, on the real NVDAx mint and real USDC, through the SDK,
 * with expiries reached by surfnet_timeTravel. Deploy first: pnpm anchor:build && pnpm anchor:deploy.
 * Skips when the fork is down or the program is not deployed.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAccount, getAssociatedTokenAddressSync } from "@solana/spl-token";
import * as anchorNs from "@anchor-lang/core";
import { RosterClient, ROSTER_PROGRAM_ID, type MarketState, type SeriesState } from "../../packages/sdk/src";
import { FORK_URL, USDC_MINT, clockUnix, forkReachable, fundSol, fundToken, loadOrCreateKey, resolveXstockMint, timeTravelTo } from "../../scripts/fork-lib";
import { ensureTier1Market } from "./market";

const anchor = ((anchorNs as { default?: unknown }).default ?? anchorNs) as typeof anchorNs;
const LOT = 1_000_000n;
const USDC = 1_000_000n;
const K180 = 180n * USDC;

const up = await forkReachable();
const connection = new Connection(FORK_URL, "confirmed");
const deployed = up && !!(await connection.getAccountInfo(ROSTER_PROGRAM_ID));

function client(kp: Keypair): RosterClient {
  return new RosterClient(connection, new anchor.Wallet(kp));
}

async function bal(ata: PublicKey, program: PublicKey): Promise<bigint> {
  try {
    return (await getAccount(connection, ata, "confirmed", program)).amount;
  } catch {
    return 0n;
  }
}

describe.skipIf(!deployed)("P1 lifecycle on the fork with the real NVDAx mint", () => {
  const deployer = loadOrCreateKey("deployer");
  const keeper = loadOrCreateKey("keeper");
  const alice = Keypair.generate();
  const bob = Keypair.generate();
  let mint: PublicKey;
  let decimals: number;
  let market: MarketState;
  let series: SeriesState;
  let expiry: bigint;

  beforeAll(async () => {
    ({ mint, decimals } = await resolveXstockMint("NVDAx"));
    for (const k of [deployer, keeper, alice, bob]) await fundSol(k.publicKey, 100e9);
    const lot = 10n ** BigInt(decimals);
    await fundToken(connection, alice, mint, TOKEN_2022_PROGRAM_ID, 1_000n * lot);
    await fundToken(connection, alice, USDC_MINT, TOKEN_PROGRAM_ID, 1_000n * USDC);
    await fundToken(connection, bob, mint, TOKEN_2022_PROGRAM_ID, 0n);
    await fundToken(connection, bob, USDC_MINT, TOKEN_PROGRAM_ID, 100_000n * USDC);
    await fundToken(connection, keeper, USDC_MINT, TOKEN_PROGRAM_ID, 0n);
    await fundToken(connection, deployer, mint, TOKEN_2022_PROGRAM_ID, 0n);
    await fundToken(connection, deployer, USDC_MINT, TOKEN_PROGRAM_ID, 0n);
  }, 120_000);

  it("initialises the protocol once and lists NVDAx from its real mint", async () => {
    const c = client(deployer);
    const now = BigInt(await clockUnix(connection));
    expiry = now + 86_400n;
    ({ market } = await ensureTier1Market(connection, [expiry, expiry + 86_400n]));
    const p = await c.fetchProtocol();
    expect(p.quoteMint.equals(USDC_MINT)).toBe(true);
    // Extension flags derived from the real mint: no fee, permanent delegate present, pausable, no live hook.
    expect(market.decimals).toBe(8);
    expect(market.tokenProgram.equals(TOKEN_2022_PROGRAM_ID)).toBe(true);
    expect(market.hasTransferFee).toBe(false);
    expect(market.hasPermanentDelegate).toBe(true);
    expect(market.pausable).toBe(true);
    expect(market.hookProgram.equals(PublicKey.default)).toBe(true);
    expect(market.listed).toBe(true);
  }, 120_000);

  it("creates a Gap series lazily with a Token-2022 position mint", async () => {
    const c = client(deployer);
    const { tx, series: addr } = await c.createSeries(market, "call", K180, expiry);
    if (!(await connection.getAccountInfo(addr))) await c.send(tx);
    series = (await c.fetchSeries(addr))!;
    expect(series.strikeUsdcPerLot).toBe(K180);
    const pm = await connection.getAccountInfo(series.positionMint);
    expect(pm!.owner.equals(TOKEN_2022_PROGRAM_ID)).toBe(true);
  }, 120_000);

  it("alice quotes 100 lots of real NVDAx into the pooled vault", async () => {
    const c = client(alice);
    await c.send(await c.quote(market, series, 100n * LOT, 100n * LOT, 5_400_000n));
    series = (await c.fetchSeries(series.address))!;
    expect(series.asks.length).toBeGreaterThan(0);
    expect(await bal(series.collateralVault, TOKEN_2022_PROGRAM_ID)).toBeGreaterThanOrEqual(100n * LOT * 100n);
  }, 120_000);

  it("bob buys 20 lots and exercises 5, paying the strike and receiving NVDAx", async () => {
    const c = client(bob);
    const usdcBefore = await bal(getAssociatedTokenAddressSync(USDC_MINT, bob.publicKey), TOKEN_PROGRAM_ID);
    await c.send(await c.buy(market, series, 20n * LOT, 5_400_000n));
    const pos = getAssociatedTokenAddressSync(series.positionMint, bob.publicKey, false, TOKEN_2022_PROGRAM_ID);
    expect(await bal(pos, TOKEN_2022_PROGRAM_ID)).toBe(20n * LOT);
    expect(usdcBefore - (await bal(getAssociatedTokenAddressSync(USDC_MINT, bob.publicKey), TOKEN_PROGRAM_ID))).toBe(20n * 5_400_000n);
    series = (await c.fetchSeries(series.address))!;
    const nvBefore = await bal(getAssociatedTokenAddressSync(mint, bob.publicKey, false, TOKEN_2022_PROGRAM_ID), TOKEN_2022_PROGRAM_ID);
    await c.send(await c.exercise(market, series, 5n * LOT));
    expect((await bal(getAssociatedTokenAddressSync(mint, bob.publicKey, false, TOKEN_2022_PROGRAM_ID), TOKEN_2022_PROGRAM_ID)) - nvBefore).toBe(5n * LOT * 100n);
    series = (await c.fetchSeries(series.address))!;
    expect(series.totalExercisedLots6).toBe(5n * LOT);
  }, 120_000);

  it("time-travels past expiry, settles alice, and closes the series after grace", async () => {
    const c = client(keeper);
    await timeTravelTo(Number(expiry) + 5);
    await c.send(await c.settleWriter(market, series, alice.publicKey));
    series = (await c.fetchSeries(series.address))!;
    expect(series.writers.find((w) => w.writer.equals(alice.publicKey))!.settled).toBe(true);
    // Alice: 100 deposited, 20 sold, 5 assigned -> 95 lots of NVDAx back and 5 x 180 USDC from settlement.
    const aliceNv = await bal(getAssociatedTokenAddressSync(mint, alice.publicKey, false, TOKEN_2022_PROGRAM_ID), TOKEN_2022_PROGRAM_ID);
    expect(aliceNv).toBe((1_000n - 100n + 95n) * LOT * 100n);
    const aliceUs = await bal(getAssociatedTokenAddressSync(USDC_MINT, alice.publicKey), TOKEN_PROGRAM_ID);
    expect(aliceUs).toBeGreaterThanOrEqual(1_000n * USDC + 5n * K180);
    await timeTravelTo(Number(expiry) + 3600 + 5);
    await c.send(await c.closeSeries(market, series, deployer.publicKey));
    expect(await connection.getAccountInfo(series.address)).toBeNull();
  }, 180_000);
});

if (!deployed) {
  it("fork not reachable or program not deployed: P1 e2e skipped", () => {
    console.warn(`fork at ${FORK_URL}: reachable=${up} deployed=${deployed}; run pnpm fork, pnpm anchor:build, pnpm anchor:deploy`);
  });
}
