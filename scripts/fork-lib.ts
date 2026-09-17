/*
 * Shared helpers for scripts and e2e tests against the surfpool fork: cheatcodes (verified on surfpool 1.0.0 in P0),
 * keypairs under .keys, mint resolution from the issuers' APIs (never from memory), and token funding that creates the
 * ATA by instruction first so the Token-2022 account keeps its extension layout (a cheatcode-created account is 165
 * bytes with no extensions; a real NVDAx ATA is 179).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync, getMint, getScaledUiAmountConfig } from "@solana/spl-token";
import { effectiveMultiplier } from "../packages/core/src/multiplier";

export const FORK_URL = process.env.FORK_RPC_URL ?? "http://127.0.0.1:8899";
/** USDC on Solana mainnet, resolved 2026-09-17 from Jupiter token search (verified, strict) and read on-chain (6 decimals, SPL Token). */
export const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
export const XSTOCKS_API = "https://api.xstocks.fi/api/v2";

export async function cheat<T = unknown>(method: string, params: unknown[], url = FORK_URL): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = (await res.json()) as { result?: T; error?: unknown };
  if (j.error) throw new Error(`${method}: ${JSON.stringify(j.error)}`);
  return j.result as T;
}

export async function forkReachable(url = FORK_URL): Promise<boolean> {
  try {
    const c = new Connection(url, "confirmed");
    await c.getSlot();
    return true;
  } catch {
    return false;
  }
}

export function loadOrCreateKey(name: string, dir = ".keys"): Keypair {
  const p = `${dir}/${name}.json`;
  if (existsSync(p)) return Keypair.fromSecretKey(new Uint8Array(JSON.parse(readFileSync(p, "utf8"))));
  const kp = Keypair.generate();
  writeFileSync(p, JSON.stringify([...kp.secretKey]));
  return kp;
}

/** Solana mint for an xStocks symbol from the Assets API (CLAUDE.md 2.1: never from memory). */
export async function resolveXstockMint(symbol: string): Promise<{ mint: PublicKey; decimals: number; name: string }> {
  const res = await fetch(`${XSTOCKS_API}/public/assets/${symbol}`);
  if (!res.ok) throw new Error(`xStocks API ${res.status} for ${symbol}`);
  const j = (await res.json()) as { name?: string; deployments?: { network: string; address: string; decimals?: number }[] };
  const dep = j.deployments?.find((d) => d.network === "Solana");
  if (!dep) throw new Error(`no Solana deployment for ${symbol}`);
  return { mint: new PublicKey(dep.address), decimals: dep.decimals ?? 8, name: j.name ?? symbol };
}

export async function xstockMultiplier(symbol: string): Promise<{ currentMultiplier: number; newMultiplier: number; activationDateTime: number; reason: string | null }> {
  const res = await fetch(`${XSTOCKS_API}/public/assets/${symbol}/multiplier?network=Solana`);
  if (!res.ok) throw new Error(`xStocks multiplier ${res.status} for ${symbol}`);
  return (await res.json()) as { currentMultiplier: number; newMultiplier: number; activationDateTime: number; reason: string | null };
}

/** Effective multiplier read from the mint itself (the on-chain truth the program's display layer must match). */
export async function onChainMultiplier(connection: Connection, mint: PublicKey, nowUnix = Math.floor(Date.now() / 1000)): Promise<number> {
  const m = await getMint(connection, mint, "confirmed", TOKEN_2022_PROGRAM_ID);
  const cfg = getScaledUiAmountConfig(m);
  if (!cfg) return 1;
  return effectiveMultiplier({ multiplier: cfg.multiplier, newMultiplier: cfg.newMultiplier, newMultiplierEffectiveTimestamp: cfg.newMultiplierEffectiveTimestamp }, nowUnix);
}

export async function fundSol(pubkey: PublicKey, lamports: number): Promise<void> {
  await cheat("surfnet_setAccount", [pubkey.toBase58(), { lamports }]);
}

/**
 * Create the ATA with a real instruction, then write the balance into the real account bytes (amount is u64 LE at
 * offset 64) with surfnet_setAccount. surfnet_setTokenAccount rewrites the account as a 165-byte base account with no
 * extensions (probed on surfpool 1.0.0), which loses ImmutableOwner, PausableAccount and TransferHookAccount.
 */
export async function fundToken(connection: Connection, owner: Keypair, mint: PublicKey, program: PublicKey, raw: bigint): Promise<PublicKey> {
  const ata = getAssociatedTokenAddressSync(mint, owner.publicKey, false, program);
  const existing = await connection.getAccountInfo(ata);
  if (existing && program.equals(TOKEN_2022_PROGRAM_ID) && existing.data.length === 165) {
    // A stale cheatcode-written account from an earlier run: revert it to upstream (absent) and recreate properly.
    await cheat("surfnet_resetAccount", [ata.toBase58()]);
  }
  if (!existing || (program.equals(TOKEN_2022_PROGRAM_ID) && existing.data.length === 165)) {
    await sendAndConfirmTransaction(connection, new Transaction().add(createAssociatedTokenAccountIdempotentInstruction(owner.publicKey, ata, owner.publicKey, mint, program)), [owner]);
  }
  const acc = await connection.getAccountInfo(ata);
  if (!acc) throw new Error(`ATA ${ata.toBase58()} missing after creation`);
  const data = Buffer.from(acc.data);
  data.writeBigUInt64LE(raw, 64);
  await cheat("surfnet_setAccount", [ata.toBase58(), { data: data.toString("hex"), owner: acc.owner.toBase58(), lamports: acc.lamports }]);
  const after = await connection.getAccountInfo(ata);
  if (!after || after.data.length !== acc.data.length) throw new Error(`ATA ${ata.toBase58()} changed size ${acc.data.length} -> ${after?.data.length}`);
  return ata;
}

export function tokenProgramFor(mintOwner: PublicKey): PublicKey {
  return mintOwner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
}

/** Move the fork clock forward to `unix` seconds (surfnet_timeTravel takes milliseconds; forward only). */
export async function timeTravelTo(unix: number): Promise<void> {
  await cheat("surfnet_timeTravel", [{ absoluteTimestamp: unix * 1000 }]);
}

export async function clockUnix(connection: Connection): Promise<number> {
  const info = await connection.getAccountInfo(new PublicKey("SysvarC1ock11111111111111111111111111111111"));
  if (!info) throw new Error("clock sysvar missing");
  // Clock: slot u64, epoch_start_timestamp i64, epoch u64, leader_schedule_epoch u64, unix_timestamp i64
  return Number(info.data.readBigInt64LE(32));
}
