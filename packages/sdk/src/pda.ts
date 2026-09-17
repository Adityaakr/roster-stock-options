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
