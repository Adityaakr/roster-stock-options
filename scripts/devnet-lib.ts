/*
 * Devnet helpers. The fork funds a wallet with cheatcodes; devnet has no cheatcodes, so the replica mints keep their
 * mint authority with the deployer and funding is an ordinary `mintTo`. Everything else is the same code as mainnet.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Connection, Keypair } from "@solana/web3.js";
import { PublicKey, Transaction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, createMintToInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { sendRawAndConfirm } from "../packages/sdk/src";
import type { DevnetMints } from "./devnet-mints";

export const DEVNET_RPC = process.env.DEVNET_RPC_URL ?? "https://api.devnet.solana.com";
const MINTS_FILE = resolve(process.cwd(), "fixtures/devnet-mints.json");

export function devnetMints(): DevnetMints {
  if (!existsSync(MINTS_FILE)) throw new Error(`${MINTS_FILE} missing: run pnpm devnet:mints first`);
  return JSON.parse(readFileSync(MINTS_FILE, "utf8")) as DevnetMints;
}

/** Poll the signature rather than the provider's block height, which runs ahead of its own blockhashes on devnet. */
export async function sendTx(connection: Connection, tx: Transaction, signers: Keypair[]): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = signers[0]!.publicKey;
  tx.sign(...signers);
  return sendRawAndConfirm(connection, tx.serialize(), lastValidBlockHeight, "confirmed");
}

/** Mint `raw` units of a replica to `owner`, creating the associated account if it is not there. What the faucet does. */
export async function mintToOwner(connection: Connection, authority: Keypair, mint: PublicKey, tokenProgram: PublicKey, owner: PublicKey, raw: bigint): Promise<string> {
  const ata = getAssociatedTokenAddressSync(mint, owner, true, tokenProgram);
  const tx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(authority.publicKey, ata, owner, mint, tokenProgram),
    createMintToInstruction(mint, ata, authority.publicKey, raw, [], tokenProgram),
  );
  return sendTx(connection, tx, [authority]);
}

export function quoteMintOf(d: DevnetMints): { mint: PublicKey; program: PublicKey; decimals: number } {
  return { mint: new PublicKey(d.quoteMint), program: TOKEN_PROGRAM_ID, decimals: d.quoteDecimals };
}
