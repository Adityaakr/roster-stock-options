import "../../scripts/env-load";
/*
 * P4 First Print done-criterion (docs/02-roadmap.md M7, docs/03-prestocks-decision.md): PreStocks contracts round-trip
 * on the fork against the real OPENAI mint with its 50 bps transfer fee reconciled to the unit on both legs. A Gap:
 * the writer deposits one lot and the vault credits what arrived; the buyer exercises and receives the raw amount
 * less the fee the mint takes on the way out. A Floor: the holder delivers gross so exactly the raw amount reaches
 * the settlement vault and is paid the full strike. Every figure is asserted against the mint's own fee config.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAccount, getAssociatedTokenAddressSync, getMint, getTransferFeeAmount, getTransferFeeConfig, calculateEpochFee } from "@solana/spl-token";
import * as anchorNs from "@anchor-lang/core";
import { RosterClient, ROSTER_PROGRAM_ID, type MarketState, type SeriesState } from "../../packages/sdk/src";
import { readRegistry } from "../../packages/registry/src";
import { nextExpiries } from "../../packages/core/src";
import { FORK_URL, USDC_MINT, clockUnix, forkReachable, fundSol, fundToken, loadOrCreateKey, timeTravelTo } from "../../scripts/fork-lib";

const anchor = ((anchorNs as { default?: unknown }).default ?? anchorNs) as typeof anchorNs;
const LOT = 1_000_000n;
const USDC = 1_000_000n;
const up = await forkReachable();
const connection = new Connection(FORK_URL, "confirmed");
const entry = readRegistry()?.entries.find((e) => e.symbol === "OPENAI" && e.escrowProof) ?? null;
const ready = up && !!(await connection.getAccountInfo(ROSTER_PROGRAM_ID)) && !!entry;

const client = (kp: Keypair) => new RosterClient(connection, new anchor.Wallet(kp));
async function bal(ata: PublicKey, program: PublicKey): Promise<bigint> {
  try { return (await getAccount(connection, ata, "confirmed", program)).amount; } catch { return 0n; }
}

describe.skipIf(!ready)("First Print: OPENAI Gap and Floor round-trip with the transfer fee reconciled", () => {
  const deployer = loadOrCreateKey("deployer");
  const alice = Keypair.generate();
  const bob = Keypair.generate();
  let mint: PublicKey;
  let market: MarketState;
  let series: SeriesState;
  let floor: SeriesState;
  let rawPerLot: bigint;
  let feeIn: (amount: bigint) => bigint;
  /** What must be sent for `raw` to arrive: the crate's inverse fee, ceil(raw x 10000 / (10000 - bps)). */
  let grossOf: (raw: bigint) => bigint;

  beforeAll(async () => {
    mint = new PublicKey(entry!.mint);
    const m = await getMint(connection, mint, "confirmed", TOKEN_2022_PROGRAM_ID);
    const cfg = getTransferFeeConfig(m)!;
    const epoch = BigInt((await connection.getEpochInfo()).epoch);
    feeIn = (amount: bigint) => calculateEpochFee(cfg, epoch, amount);
    const bps = BigInt((epoch >= cfg.newerTransferFee.epoch ? cfg.newerTransferFee : cfg.olderTransferFee).transferFeeBasisPoints);
    grossOf = (raw: bigint) => (raw * 10_000n + (10_000n - bps) - 1n) / (10_000n - bps);
    rawPerLot = 10n ** BigInt(m.decimals);
    for (const k of [deployer, alice, bob]) await fundSol(k.publicKey, 50e9);
    await fundToken(connection, alice, mint, TOKEN_2022_PROGRAM_ID, 10n * rawPerLot);
    await fundToken(connection, alice, USDC_MINT, TOKEN_PROGRAM_ID, 100_000n * USDC);
    await fundToken(connection, bob, mint, TOKEN_2022_PROGRAM_ID, 10n * rawPerLot);
    await fundToken(connection, bob, USDC_MINT, TOKEN_PROGRAM_ID, 100_000n * USDC);
    market = (await client(deployer).fetchMarket(mint))!;
    expect(market.hasTransferFee).toBe(true);
    // The fork's clock is shared and this file travels through an expiry; if the grid the keeper rolled is now in the
    // past, roll it here rather than depending on the keeper's next pass.
    const now = BigInt(await clockUnix(connection));
    if (!market.allowedExpiries.some((e) => e > now)) {
      const c = client(deployer);
      await c.send(await c.updateMarket(mint, { allowedExpiries: nextExpiries(Number(now), 2, [5]).map(BigInt) }));
      market = (await c.fetchMarket(mint))!;
    }
    // Earlier runs on this shared fork leave their series live until they expire and close; this file needs two
    // slots of its own, so the cap is lifted here (a fork-only device; on a real cluster the keeper closes them).
    if (market.liveSeries + 2 > market.maxLiveSeries) {
      const c = client(deployer);
      await c.send(await c.updateMarket(mint, { maxLiveSeries: market.liveSeries + 2 }));
      market = (await c.fetchMarket(mint))!;
    }
  }, 120_000);

  it("creates a Gap and a Floor at the nearest expiry", async () => {
    const c = client(deployer);
    const now = BigInt(await clockUnix(connection));
    const expiry = market.allowedExpiries.filter((e) => e > now).sort((a, b) => (a < b ? -1 : 1))[0]!;
    const strike = market.minStrike + market.strikeStep * 10n;
    const call = await c.createSeries(market, "call", strike, expiry);
    if (!(await connection.getAccountInfo(call.series))) await c.send(call.tx);
    series = (await c.fetchSeries(call.series))!;
    const put = await c.createSeries(market, "put", strike, expiry);
    if (!(await connection.getAccountInfo(put.series))) await c.send(put.tx);
    floor = (await c.fetchSeries(put.series))!;
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

  it("a Floor: the holder delivers gross so exactly the raw amount arrives, and is paid the full strike", async () => {
    // Alice writes the Floor: USDC collateral, no fee on this leg.
    const w = client(alice);
    await w.send(await w.quote(market, floor, LOT, LOT, 2n * USDC));
    floor = (await w.fetchSeries(floor.address))!;
    // Bob buys half a lot and exercises it: he must deliver the fee on top so the writers get every unit.
    const c = client(bob);
    const lots = LOT / 2n;
    await c.send(await c.buy(market, floor, lots, 3n * USDC));
    floor = (await c.fetchSeries(floor.address))!;
    const tokensBefore = await bal(getAssociatedTokenAddressSync(mint, bob.publicKey, false, TOKEN_2022_PROGRAM_ID), TOKEN_2022_PROGRAM_ID);
    const usdcBefore = await bal(getAssociatedTokenAddressSync(USDC_MINT, bob.publicKey), TOKEN_PROGRAM_ID);
    const vaultBefore = await bal(floor.settlementVault, TOKEN_2022_PROGRAM_ID);
    await c.send(await c.exercise(market, floor, lots));
    const raw = (lots * rawPerLot) / LOT;
    expect(tokensBefore - (await bal(getAssociatedTokenAddressSync(mint, bob.publicKey, false, TOKEN_2022_PROGRAM_ID), TOKEN_2022_PROGRAM_ID))).toBe(grossOf(raw));
    expect((await bal(floor.settlementVault, TOKEN_2022_PROGRAM_ID)) - vaultBefore).toBe(raw);
    const paid = (lots * floor.strikeUsdcPerLot) / LOT;
    expect((await bal(getAssociatedTokenAddressSync(USDC_MINT, bob.publicKey), TOKEN_PROGRAM_ID)) - usdcBefore).toBe(paid);
  }, 180_000);

  it("closes after expiry: the fee the mint withheld in the vault is harvested, so the rent comes back", async () => {
    const c = client(deployer);
    const grace = (await c.fetchProtocol()).graceSecs;
    await timeTravelTo(Number(series.expiryTs + grace) + 5);
    series = (await c.fetchSeries(series.address))!;
    await c.send(await c.settleWriter(market, series, alice.publicKey));
    series = (await c.fetchSeries(series.address))!;
    floor = (await c.fetchSeries(floor.address))!;
    // The Floor's writer is assigned the raw the holder delivered, less the mint's fee on the way out to her.
    const aliceBefore = await bal(getAssociatedTokenAddressSync(mint, alice.publicKey, false, TOKEN_2022_PROGRAM_ID), TOKEN_2022_PROGRAM_ID);
    await c.send(await c.settleWriter(market, floor, alice.publicKey));
    const assigned = (LOT / 2n) * rawPerLot / LOT;
    expect((await bal(getAssociatedTokenAddressSync(mint, alice.publicKey, false, TOKEN_2022_PROGRAM_ID), TOKEN_2022_PROGRAM_ID)) - aliceBefore).toBe(assigned - feeIn(assigned));
    floor = (await c.fetchSeries(floor.address))!;
    await c.send(await c.closeSeries(market, floor, deployer.publicKey));
    expect(await connection.getAccountInfo(floor.address)).toBeNull();

    // Every transfer into the vault left part of itself behind as a withheld fee, which Token-2022 refuses to let an
    // account carry into its own closure; close_series harvests it to the mint first.
    const vault = await getAccount(connection, series.collateralVault, "confirmed", TOKEN_2022_PROGRAM_ID);
    const withheld = getTransferFeeAmount(vault)!.withheldAmount;
    expect(withheld).toBeGreaterThan(0n);
    const mintWithheldBefore = getTransferFeeConfig((await getMint(connection, mint, "confirmed", TOKEN_2022_PROGRAM_ID)))!.withheldAmount;
    const rentBefore = await connection.getBalance(series.rentPayer);

    await c.send(await c.closeSeries(market, series, deployer.publicKey));
    expect(await connection.getAccountInfo(series.address)).toBeNull();
    expect(await connection.getAccountInfo(series.collateralVault)).toBeNull();
    expect(await connection.getBalance(series.rentPayer)).toBeGreaterThan(rentBefore);
    const mintWithheldAfter = getTransferFeeConfig((await getMint(connection, mint, "confirmed", TOKEN_2022_PROGRAM_ID)))!.withheldAmount;
    expect(mintWithheldAfter - mintWithheldBefore).toBe(withheld);
  }, 180_000);
});

if (!ready) {
  it("First Print e2e skipped", () => {
    console.warn(`fork reachable=${up}, OPENAI proven in registry=${!!entry}; run pnpm registry && pnpm list-markets OPENAI`);
  });
}
