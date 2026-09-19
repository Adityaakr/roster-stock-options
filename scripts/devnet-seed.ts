import "./env-load";
/*
 * Seed the devnet treasury: mint each replica and the quote token to the wallet that quotes, so the maker has
 * inventory to write Gaps against and cash to back Floors. Devnet money is minted, not bought, which is the whole
 * point of a test cluster; the sizes here mirror docs/SEEDING.md's shape, not its risk.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { DEVNET_RPC, devnetMints, mintToOwner, quoteMintOf } from "./devnet-lib";
import { loadOrCreateKey } from "./fork-lib";

const TOKENS_PER_MARKET = 2_000;
const QUOTE_TOKENS = 2_000_000;

async function main(): Promise<void> {
  const connection = new Connection(DEVNET_RPC, "confirmed");
  const payer = loadOrCreateKey("deployer");
  const d = devnetMints();
  const quote = quoteMintOf(d);
  // An address argument seeds that wallet instead: how the operator hands a tester their first tokens.
  const arg = process.argv.slice(2).find((a) => !a.startsWith("--"));
  const owner = arg ? new PublicKey(arg) : payer.publicKey;

  for (const m of d.mints) {
    const raw = BigInt(TOKENS_PER_MARKET) * 10n ** BigInt(m.decimals);
    const sig = await mintToOwner(connection, payer, new PublicKey(m.mint), TOKEN_2022_PROGRAM_ID, owner, raw);
    console.log(`${m.symbol.padEnd(8)} ${TOKENS_PER_MARKET} to ${owner.toBase58().slice(0, 8)}… ${sig.slice(0, 12)}…`);
  }
  const sig = await mintToOwner(connection, payer, quote.mint, quote.program, owner, BigInt(QUOTE_TOKENS) * 10n ** BigInt(quote.decimals));
  console.log(`quote    ${QUOTE_TOKENS} to ${owner.toBase58().slice(0, 8)}… ${sig.slice(0, 12)}…`);
}

await main();
