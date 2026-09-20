import { PublicKey } from "@solana/web3.js";

export type Side = "call" | "put";

const PROTOCOL = Buffer.from("protocol");
const MARKET = Buffer.from("market");
const SERIES = Buffer.from("series");
const CVAULT = Buffer.from("cvault");
const SVAULT = Buffer.from("svault");
const QVAULT = Buffer.from("qvault");
const PMINT = Buffer.from("pmint");
const AUTOEX = Buffer.from("autoex");
const AUTOEX_AUTHORITY = Buffer.from("autoex_authority");

function u64le(v: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v);
  return b;
}
function i64le(v: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigInt64LE(v);
  return b;
}

export function protocolPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([PROTOCOL], programId)[0];
}
export function marketPda(programId: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([MARKET, mint.toBuffer()], programId)[0];
}
export function seriesPda(programId: PublicKey, market: PublicKey, side: Side, strikeUsdcPerLot: bigint, expiryTs: bigint): PublicKey {
  return PublicKey.findProgramAddressSync([SERIES, market.toBuffer(), Buffer.from([side === "call" ? 0 : 1]), u64le(strikeUsdcPerLot), i64le(expiryTs)], programId)[0];
}
export function vaultPdas(programId: PublicKey, series: PublicKey): { collateral: PublicKey; settlement: PublicKey; quote: PublicKey; positionMint: PublicKey } {
  const d = (seed: Buffer) => PublicKey.findProgramAddressSync([seed, series.toBuffer()], programId)[0];
  return { collateral: d(CVAULT), settlement: d(SVAULT), quote: d(QVAULT), positionMint: d(PMINT) };
}
export function autoExercisePda(programId: PublicKey, holder: PublicKey, series: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([AUTOEX, holder.toBuffer(), series.toBuffer()], programId)[0];
}
export function autoExerciseAuthority(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([AUTOEX_AUTHORITY], programId)[0];
}

// Part 3: the vaults.
export const VAULT_COVERED_CALL = 0;
export const VAULT_CASH_SECURED_PUT = 1;
export type VaultKind = "covered_call" | "cash_secured_put";
export function vaultKindByte(kind: VaultKind): number {
  return kind === "covered_call" ? VAULT_COVERED_CALL : VAULT_CASH_SECURED_PUT;
}
export function vaultPda(programId: PublicKey, market: PublicKey, kind: VaultKind): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("vault"), market.toBuffer(), Buffer.from([vaultKindByte(kind)])], programId)[0];
}
export function vaultShareMint(programId: PublicKey, vault: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("vshares"), vault.toBuffer()], programId)[0];
}
export function vaultPositionPda(programId: PublicKey, vault: PublicKey, owner: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("vpos"), vault.toBuffer(), owner.toBuffer()], programId)[0];
}
export function epochRecordPda(programId: PublicKey, vault: PublicKey, epoch: number): PublicKey {
  const e = Buffer.alloc(4);
  e.writeUInt32LE(epoch);
  return PublicKey.findProgramAddressSync([Buffer.from("vepoch"), vault.toBuffer(), e], programId)[0];
}
export function vaultBidPda(programId: PublicKey, vault: PublicKey, series: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("vbid"), vault.toBuffer(), series.toBuffer()], programId)[0];
}
