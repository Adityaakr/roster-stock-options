/*
 * Shared fork setup: the protocol and the Tier 1 NVDAx market exactly as P1 lists them (feed ids from CLAUDE.md 1,
 * extension flags read from the real mint). Idempotent so any e2e file can run first on a fresh fork.
 */
import type { Connection, Keypair, PublicKey } from "@solana/web3.js";
import * as anchorNs from "@anchor-lang/core";
import { RosterClient, type MarketState } from "../../packages/sdk/src";
import { USDC_MINT, clockUnix, fundSol, loadOrCreateKey, resolveXstockMint } from "../../scripts/fork-lib";

const anchor = ((anchorNs as { default?: unknown }).default ?? anchorNs) as typeof anchorNs;
const LOT = 1_000_000n;
const USDC = 1_000_000n;
export const NVDAX_FEED = Buffer.from("4244d07890e4610f46bbde67de8f43a4bf8b569eebe904f136b469f148503b7f", "hex");
export const NVDA_FEED = Buffer.from("b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593", "hex");

export async function ensureTier1Market(connection: Connection, expiries: bigint[]): Promise<{ mint: PublicKey; decimals: number; market: MarketState }> {
  const deployer = loadOrCreateKey("deployer");
  const keeper = loadOrCreateKey("keeper");
  await fundSol(deployer.publicKey, 100e9);
  const c = new RosterClient(connection, new anchor.Wallet(deployer as Keypair));
  const { mint, decimals } = await resolveXstockMint("NVDAx");
  if (!(await connection.getAccountInfo(c.protocol))) {
    await c.send(await c.initProtocol(USDC_MINT, { pauseAuthority: keeper.publicKey, treasury: deployer.publicKey, feeBps: 10, integratorShareBps: 3000, keeperFeeUsdc: 2n * USDC, graceSecs: 3600n }));
  }
  // The quoter wallet creates the grid's series on Tier 1 and 2 markets (the program limits creation there).
  const quoter = loadOrCreateKey("quoter");
  if (!(await c.fetchProtocol()).seriesCreator.equals(quoter.publicKey)) await c.send(await c.updateProtocol({ seriesCreator: quoter.publicKey }));
  let m = await c.fetchMarket(mint);
  if (!m) {
    await c.send(await c.createMarket({ mint, tokenFeedId: NVDAX_FEED, equityFeedId: NVDA_FEED, allowedExpiries: expiries, strikeStep: USDC, minStrike: 100n * USDC, maxStrike: 300n * USDC, maxLiveSeries: 12, minLots6: LOT / 100n, maxLots6: 10_000n * LOT, maxWriterLots6: 5_000n * LOT, tier: 1, maxPriceAgeSecs: 60, maxConfBps: 100, symbol: "NVDAx", feedPricesUiShare: true }));
  } else {
    await c.send(await c.updateMarket(mint, { allowedExpiries: expiries }));
  }
  m = await c.fetchMarket(mint);
  return { mint, decimals, market: m! };
}

export { clockUnix };
