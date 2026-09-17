/*
 * The per-mint eligibility check (Part 2 section 2), read from the chain: token program, every Token-2022 extension,
 * freeze authority, permanent delegate, transfer hook and whether it is live, transfer fee, pausable state, scaled UI
 * amount, decimals. The verdict is a rule over those facts; the escrow round trip on the fork is proven separately
 * by scripts/list-markets.ts and recorded next to it.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { ExtensionType, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getExtensionTypes, getMint, getPausableConfig, getPermanentDelegate, getScaledUiAmountConfig, getTransferFeeConfig, getTransferHook } from "@solana/spl-token";

export type Verdict = "eligible" | "eligible_with_fee" | "restricted_wrapper" | "ineligible";

export interface MintInspection {
  mint: string;
  tokenProgram: "token" | "token-2022" | "unknown";
  decimals: number;
  supply: string;
  extensions: string[];
  freezeAuthority: string | null;
  mintAuthority: string | null;
  permanentDelegate: string | null;
  transferHook: { program: string; live: boolean } | null;
  transferFee: { bps: number; maxFee: string } | null;
  pausable: { paused: boolean; authority: string | null } | null;
  scaledUiAmount: { multiplier: number; newMultiplier: number; newMultiplierEffectiveTimestamp: number } | null;
  verdict: Verdict;
  reason: string;
}

export async function inspectMint(connection: Connection, mintAddress: PublicKey): Promise<MintInspection> {
  const info = await connection.getAccountInfo(mintAddress);
  if (!info) throw new Error(`mint ${mintAddress.toBase58()} not found`);
  const program = info.owner.equals(TOKEN_2022_PROGRAM_ID) ? "token-2022" : info.owner.equals(TOKEN_PROGRAM_ID) ? "token" : "unknown";
  if (program === "unknown") {
    return { mint: mintAddress.toBase58(), tokenProgram: "unknown", decimals: 0, supply: "0", extensions: [], freezeAuthority: null, mintAuthority: null, permanentDelegate: null, transferHook: null, transferFee: null, pausable: null, scaledUiAmount: null, verdict: "ineligible", reason: `owned by ${info.owner.toBase58()}, not a token program` };
  }
  const m = await getMint(connection, mintAddress, "confirmed", info.owner);
  const extensions = m.tlvData.length ? getExtensionTypes(m.tlvData).map((t) => ExtensionType[t] ?? `Unknown(${t})`) : [];
  const delegate = program === "token-2022" ? getPermanentDelegate(m) : null;
  const hook = program === "token-2022" ? getTransferHook(m) : null;
  const fee = program === "token-2022" ? getTransferFeeConfig(m) : null;
  const pausable = program === "token-2022" ? getPausableConfig(m) : null;
  const scaled = program === "token-2022" ? getScaledUiAmountConfig(m) : null;
  const hookLive = hook && !hook.programId.equals(PublicKey.default) ? !!(await connection.getAccountInfo(hook.programId))?.executable : false;
  const out: MintInspection = {
    mint: mintAddress.toBase58(),
    tokenProgram: program,
    decimals: m.decimals,
    supply: m.supply.toString(),
    extensions,
    freezeAuthority: m.freezeAuthority?.toBase58() ?? null,
    mintAuthority: m.mintAuthority?.toBase58() ?? null,
    permanentDelegate: delegate && !delegate.delegate.equals(PublicKey.default) ? delegate.delegate.toBase58() : null,
    transferHook: hook && !hook.programId.equals(PublicKey.default) ? { program: hook.programId.toBase58(), live: hookLive } : null,
    transferFee: fee ? { bps: fee.newerTransferFee.transferFeeBasisPoints, maxFee: fee.newerTransferFee.maximumFee.toString() } : null,
    pausable: pausable ? { paused: pausable.paused, authority: pausable.authority && !pausable.authority.equals(PublicKey.default) ? pausable.authority.toBase58() : null } : null,
    scaledUiAmount: scaled ? { multiplier: scaled.multiplier, newMultiplier: scaled.newMultiplier, newMultiplierEffectiveTimestamp: Number(scaled.newMultiplierEffectiveTimestamp) } : null,
    verdict: "eligible",
    reason: ""
  };
  const v = verdictFor(out);
  out.verdict = v.verdict;
  out.reason = v.reason;
  return out;
}

/**
 * The rule. A live transfer hook is a restricted wrapper until its extra accounts are resolved and proven on the
 * fork; a transfer fee is eligible with fee (Floors wait for fee-inclusive settlement, docs/BUILD_LOG.md M2.1); fewer
 * than six decimals cannot express a lot; a paused mint is listed but halted.
 */
export function verdictFor(i: MintInspection): { verdict: Verdict; reason: string } {
  if (i.tokenProgram === "unknown") return { verdict: "ineligible", reason: i.reason };
  if (i.decimals < 6) return { verdict: "ineligible", reason: `${i.decimals} decimals: a lot is 1e6 units and the program requires at least six` };
  if (i.extensions.includes("NonTransferable")) return { verdict: "ineligible", reason: "non-transferable mint" };
  if (i.transferHook?.live) return { verdict: "restricted_wrapper", reason: `live transfer hook ${i.transferHook.program}: escrow transfers need its extra accounts, not yet proven` };
  if (i.transferFee && i.transferFee.bps > 0) return { verdict: "eligible_with_fee", reason: `${i.transferFee.bps} bps transfer fee: Gaps only until fee-inclusive settlement ships` };
  const notes: string[] = [];
  if (i.permanentDelegate) notes.push("issuer holds a permanent delegate");
  if (i.pausable) notes.push(i.pausable.paused ? "mint is paused now" : "pausable by the issuer");
  if (i.freezeAuthority) notes.push("freeze authority present");
  if (i.transferHook && !i.transferHook.live) notes.push("transfer hook slot present but no program deployed");
  return { verdict: "eligible", reason: notes.join("; ") || "plain mint" };
}
