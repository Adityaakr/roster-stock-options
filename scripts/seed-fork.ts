import "./env-load";
/*
 * Seed the fork: SOL for every key, NVDAx and USDC for alice, bob, quoter and the treasury (deployer). Mints come from
 * the xStocks API and the verified USDC constant; balances are set through the cheatcode after the ATA exists.
 * Prints a JSON summary the e2e tests and the services read from .keys/seed.json.
 */
import { writeFileSync } from "node:fs";
import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { FORK_URL, USDC_MINT, clockUnix, fundSol, fundToken, loadOrCreateKey, onChainMultiplier, resolveXstockMint, xstockMultiplier } from "./fork-lib";
import { readRegistry } from "../packages/registry/src";

const SYMBOL = process.env.SEED_SYMBOL ?? "NVDAx";
const EXTRA = (readRegistry()?.entries ?? []).map((e) => e.symbol).filter((s) => s !== SYMBOL);

async function main() {
  const connection = new Connection(FORK_URL, "confirmed");
  const { mint, decimals, name } = await resolveXstockMint(SYMBOL);
  const mintInfo = await connection.getAccountInfo(mint);
  if (!mintInfo) throw new Error(`${SYMBOL} mint ${mint.toBase58()} not on the fork`);
  if (!mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID)) throw new Error(`${SYMBOL} mint is not Token-2022`);
  const keys = ["deployer", "keeper", "quoter", "alice", "bob"].map((n) => [n, loadOrCreateKey(n)] as const);
  for (const [, kp] of keys) await fundSol(kp.publicKey, 100 * 1e9);
  const out: Record<string, unknown> = { fork: FORK_URL, symbol: SYMBOL, name, mint: mint.toBase58(), decimals, usdc: USDC_MINT.toBase58(), wallets: {} };
  const lot = 10n ** BigInt(decimals);
  for (const [n, kp] of keys) {
    if (n === "keeper") continue;
    const nv = await fundToken(connection, kp, mint, TOKEN_2022_PROGRAM_ID, 1_000n * lot);
    const us = await fundToken(connection, kp, USDC_MINT, TOKEN_PROGRAM_ID, 500_000n * 1_000_000n);
    (out.wallets as Record<string, unknown>)[n] = { pubkey: kp.publicKey.toBase58(), underlyingAta: nv.toBase58(), usdcAta: us.toBase58() };
  }
  // Every other registry market too, so the quoter and the test wallets can write Gaps on all of them.
  for (const sym of EXTRA) {
    const r = await resolveXstockMint(sym).catch(() => null);
    if (!r) continue;
    for (const [n, kp] of keys) if (n !== "keeper") await fundToken(connection, kp, r.mint, TOKEN_2022_PROGRAM_ID, 1_000n * 10n ** BigInt(r.decimals));
    console.log(`funded ${sym} for ${keys.length - 1} wallets`);
  }
  out.multiplierOnChain = await onChainMultiplier(connection, mint);
  out.multiplierApi = (await xstockMultiplier(SYMBOL)).currentMultiplier;
  out.clockUnix = await clockUnix(connection);
  writeFileSync(".keys/seed.json", JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
