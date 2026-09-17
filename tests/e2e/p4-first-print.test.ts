import "../../scripts/env-load";
/*
 * P4 First Print done-criterion (docs/02-roadmap.md M7): one tKalshi contract round-trips on the fork with the 20 bps
 * transfer fee reconciled to the unit on both legs. The writer deposits one lot and the vault credits what arrived;
 * the buyer exercises and receives the raw amount less the fee the mint takes on the way out; every figure is
 * asserted against the mint's own fee config, never a constant.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAccount, getAssociatedTokenAddressSync, getMint, getTransferFeeConfig, calculateEpochFee } from "@solana/spl-token";
import * as anchorNs from "@anchor-lang/core";
import { RosterClient, ROSTER_PROGRAM_ID, type MarketState, type SeriesState } from "../../packages/sdk/src";
import { readRegistry } from "../../packages/registry/src";
import { FORK_URL, USDC_MINT, clockUnix, forkReachable, fundSol, fundToken, loadOrCreateKey } from "../../scripts/fork-lib";

const anchor = ((anchorNs as { default?: unknown }).default ?? anchorNs) as typeof anchorNs;
const LOT = 1_000_000n;
const USDC = 1_000_000n;
const up = await forkReachable();
const connection = new Connection(FORK_URL, "confirmed");
const entry = readRegistry()?.entries.find((e) => e.symbol === "tKalshi" && e.escrowProof) ?? null;
const ready = up && !!(await connection.getAccountInfo(ROSTER_PROGRAM_ID)) && !!entry;

const client = (kp: Keypair) => new RosterClient(connection, new anchor.Wallet(kp));
async function bal(ata: PublicKey, program: PublicKey): Promise<bigint> {
  try { return (await getAccount(connection, ata, "confirmed", program)).amount; } catch { return 0n; }
}

describe.skipIf(!ready)("First Print: a tKalshi Gap round-trips with the transfer fee reconciled", () => {
  const deployer = loadOrCreateKey("deployer");
  const alice = Keypair.generate();
  const bob = Keypair.generate();
  let mint: PublicKey;
  let market: MarketState;
  let series: SeriesState;
  let rawPerLot: bigint;
  let feeIn: (amount: bigint) => bigint;

  beforeAll(async () => {
    mint = new PublicKey(entry!.mint);
    const m = await getMint(connection, mint, "confirmed", TOKEN_2022_PROGRAM_ID);
    const cfg = getTransferFeeConfig(m)!;
    const epoch = BigInt((await connection.getEpochInfo()).epoch);
    feeIn = (amount: bigint) => calculateEpochFee(cfg, epoch, amount);
    rawPerLot = 10n ** BigInt(m.decimals);
    for (const k of [deployer, alice, bob]) await fundSol(k.publicKey, 50e9);
    await fundToken(connection, alice, mint, TOKEN_2022_PROGRAM_ID, 10n * rawPerLot);
    await fundToken(connection, alice, USDC_MINT, TOKEN_PROGRAM_ID, 0n);
    await fundToken(connection, bob, mint, TOKEN_2022_PROGRAM_ID, 0n);
    await fundToken(connection, bob, USDC_MINT, TOKEN_PROGRAM_ID, 100_000n * USDC);
    market = (await client(deployer).fetchMarket(mint))!;
    expect(market.hasTransferFee).toBe(true);
  }, 120_000);

  it("creates a Gap at the nearest expiry (Floors are refused on a fee mint)", async () => {
    const c = client(deployer);
    const now = BigInt(await clockUnix(connection));
    const expiry = market.allowedExpiries.filter((e) => e > now).sort((a, b) => (a < b ? -1 : 1))[0]!;
    const strike = market.minStrike + market.strikeStep * 10n;
    const put = await c.createSeries(market, "put", strike, expiry);
    await expect(c.send(put.tx)).rejects.toThrow();
    const call = await c.createSeries(market, "call", strike, expiry);
    if (!(await connection.getAccountInfo(call.series))) await c.send(call.tx);
    series = (await c.fetchSeries(call.series))!;
  }, 120_000);

  it("credits the writer exactly what arrived after the mint's fee", async () => {
    const c = client(alice);
    const vaultBefore = await bal(series.collateralVault, TOKEN_2022_PROGRAM_ID);
    const askLots = LOT - 10_000n;
    await c.send(await c.quote(market, series, LOT, askLots, 2n * USDC));
    const vaultAfter = await bal(series.collateralVault, TOKEN_2022_PROGRAM_ID);
    const arrived = vaultAfter - vaultBefore;
    expect(arrived).toBe(rawPerLot - feeIn(rawPerLot));
    series = (await c.fetchSeries(series.address))!;
    const slot = series.writers.find((w) => w.writer.equals(alice.publicKey))!;
    expect(slot.depositedLots6).toBe((arrived * LOT) / rawPerLot);
  }, 120_000);

  it("bob buys half a lot and on exercise receives the raw amount less the fee on the way out", async () => {
    const c = client(bob);
    const lots = LOT / 2n;
    await c.send(await c.buy(market, series, lots, 2n * USDC));
    const before = await bal(getAssociatedTokenAddressSync(mint, bob.publicKey, false, TOKEN_2022_PROGRAM_ID), TOKEN_2022_PROGRAM_ID);
    const usdcBefore = await bal(getAssociatedTokenAddressSync(USDC_MINT, bob.publicKey), TOKEN_PROGRAM_ID);
    series = (await c.fetchSeries(series.address))!;
    await c.send(await c.exercise(market, series, lots));
    const after = await bal(getAssociatedTokenAddressSync(mint, bob.publicKey, false, TOKEN_2022_PROGRAM_ID), TOKEN_2022_PROGRAM_ID);
    const raw = (lots * rawPerLot) / LOT;
    expect(after - before).toBe(raw - feeIn(raw));
    // The strike is paid in full: fees never touch the USDC leg.
    const owed = (lots * series.strikeUsdcPerLot + LOT - 1n) / LOT;
    expect(usdcBefore - (await bal(getAssociatedTokenAddressSync(USDC_MINT, bob.publicKey), TOKEN_PROGRAM_ID))).toBe(owed);
  }, 120_000);
});

if (!ready) {
  it("First Print e2e skipped", () => {
    console.warn(`fork reachable=${up}, tKalshi proven in registry=${!!entry}; run pnpm registry && pnpm list-markets tKalshi`);
  });
}
