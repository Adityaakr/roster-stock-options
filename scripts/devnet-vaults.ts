import "./env-load";
/*
 * Create the Part 3 vaults on devnet and seed them: a Covered Call vault and a Cash-Secured Put vault on each named
 * market, the deployer as manager, a daily roll on devnet's compressed calendar. The treasury's first deposit is the
 * vault's seed; it enters at the first roll like anyone else's. Idempotent.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import * as anchorNs from "@anchor-lang/core";
import { RosterClient, type VaultKind } from "../packages/sdk/src";
import { nextExpiries } from "../packages/core/src";
import { readRegistry, registryPathFor } from "../packages/registry/src";
import { DEVNET_RPC, devnetMints, mintToOwner, quoteMintOf } from "./devnet-lib";
import { clockUnix, loadOrCreateKey } from "./fork-lib";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";

const anchor = ((anchorNs as { default?: unknown }).default ?? anchorNs) as typeof anchorNs;
const LOT = 1_000_000n;
const USDC = 1_000_000n;
const args = process.argv.slice(2);
const symbols = args.filter((a) => !a.startsWith("--"));
const SEED_TOKENS = 100n;
const SEED_USDC = 20_000n;

async function main(): Promise<void> {
  const connection = new Connection(DEVNET_RPC, "confirmed");
  const deployer = loadOrCreateKey("deployer");
  const c = new RosterClient(connection, new anchor.Wallet(deployer));
  const reg = readRegistry(registryPathFor("devnet"));
  if (!reg) throw new Error("run pnpm devnet:registry first");
  const mints = devnetMints();
  const quote = quoteMintOf(mints);
  const now = await clockUnix(connection);
  // The first roll: tomorrow's expiry plus an hour, so the vault can write tomorrow's series right away.
  const firstRoll = BigInt(nextExpiries(now, 1, [0, 1, 2, 3, 4, 5, 6])[0]! + 3600);
  for (const e of reg.entries) {
    if (symbols.length && !symbols.includes(e.symbol)) continue;
    if (!e.escrowProof) continue;
    const mint = new PublicKey(e.mint);
    const m = await c.fetchMarket(mint);
    if (!m) { console.log(`${e.symbol}: not listed, skipped`); continue; }
    const kinds: VaultKind[] = ["covered_call", "cash_secured_put"];
    for (const kind of kinds) {
      let v = await c.fetchVault(m, kind);
      if (!v) {
        await c.send(await c.initVault(m, kind, { manager: deployer.publicKey, rollIntervalSecs: 86_400n, firstRollTs: firstRoll, capPerSeriesLots6: 50n * LOT, capTotalLots6: 0n, spreadBps: 800, markBandBps: 2_500 }));
        v = (await c.fetchVault(m, kind))!;
        console.log(`${e.symbol} ${kind}: vault ${v.address.toBase58()} created, first roll ${new Date(Number(firstRoll) * 1000).toISOString()}`);
      } else {
        console.log(`${e.symbol} ${kind}: vault ${v.address.toBase58()} epoch ${v.epoch}, shares ${v.totalShares}`);
      }
      // `--roll-now` brings the next roll to this minute, so the seed enters and the vault starts quoting today.
      if (args.includes("--roll-now") && v.epoch === 0 && v.nextRollTs > BigInt(now + 120)) {
        await c.send(await c.setVaultParams(m, kind, { nextRollTs: BigInt(now) }));
        console.log(`${e.symbol} ${kind}: next roll brought forward to now`);
      }
      // `--align` puts the next roll an hour after the next expiry, so every series the vault writes settles before
      // the roll and the roll follows the calendar rather than the minute the vault was created.
      if (args.includes("--align") && v.epoch >= 1 && v.nextRollTs !== firstRoll) {
        await c.send(await c.setVaultParams(m, kind, { nextRollTs: firstRoll }));
        console.log(`${e.symbol} ${kind}: next roll aligned to ${new Date(Number(firstRoll) * 1000).toISOString()}`);
      }
      // `--top-up <usdc>` queues more USDC into a cash-secured-put vault (it enters at the next roll): a put on a
      // token priced in the thousands needs more than the default seed to cover its three strikes.
      const topUp = args.indexOf("--top-up");
      if (topUp >= 0 && kind === "cash_secured_put") {
        const raw = BigInt(args[topUp + 1] ?? "0") * USDC;
        if (raw > 0n) {
          await mintToOwner(connection, deployer, quote.mint, quote.program, deployer.publicKey, raw);
          await c.send(await c.vaultDeposit(m, kind, raw));
          console.log(`${e.symbol} ${kind}: queued ${raw / USDC} USDC more, enters at the next roll`);
        }
      }
      // Seed: the treasury deposits, minted fresh on devnet. Skipped when the vault already has shares or a queue.
      if (v.totalShares === 0n && v.pendingDepositRaw === 0n) {
        const raw = kind === "covered_call" ? SEED_TOKENS * 10n ** BigInt(m.decimals) : SEED_USDC * USDC;
        if (kind === "covered_call") await mintToOwner(connection, deployer, mint, TOKEN_2022_PROGRAM_ID, deployer.publicKey, raw);
        else await mintToOwner(connection, deployer, quote.mint, quote.program, deployer.publicKey, raw);
        await c.send(await c.vaultDeposit(m, kind, raw));
        console.log(`${e.symbol} ${kind}: seeded ${kind === "covered_call" ? `${SEED_TOKENS} ${e.symbol}` : `${SEED_USDC} USDC`}, enters at the first roll`);
      }
    }
  }
}

await main();
