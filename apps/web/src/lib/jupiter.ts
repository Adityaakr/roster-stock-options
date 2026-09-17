import "server-only";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";

/*
 * Jupiter swap API (station.jup.ag/docs, swap v1): a quote and the swap's instructions, composed client-side into one
 * transaction with the program's `buy` for Protected Buy (CLAUDE.md 5). The keyless lite host is the default; a
 * JUPITER_API_KEY switches to the keyed host with the same routes.
 */
const HOST = process.env.JUPITER_API_KEY ? "https://api.jup.ag/swap/v1" : "https://lite-api.jup.ag/swap/v1";
const HEADERS: Record<string, string> = { "content-type": "application/json", ...(process.env.JUPITER_API_KEY ? { "x-api-key": process.env.JUPITER_API_KEY } : {}) };

export interface JupiterQuote {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  priceImpactPct: string;
  routePlan: { swapInfo: { label: string; ammKey: string } ; percent: number }[];
}

interface IxJson { programId: string; accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[]; data: string }

export interface JupiterSwapIxs {
  computeBudget: TransactionInstruction[];
  setup: TransactionInstruction[];
  swap: TransactionInstruction;
  cleanup: TransactionInstruction | null;
  lookupTables: PublicKey[];
  computeUnitLimit: number;
}

export async function jupiterQuote(inputMint: string, outputMint: string, amount: bigint, slippageBps = 50, excludeDexes: string[] = []): Promise<JupiterQuote> {
  const url = `${HOST}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount.toString()}&slippageBps=${slippageBps}&restrictIntermediateTokens=true${excludeDexes.length ? `&excludeDexes=${encodeURIComponent(excludeDexes.join(","))}` : ""}`;
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`jupiter quote: HTTP ${res.status} ${(await res.text()).slice(0, 160)}`);
  return (await res.json()) as JupiterQuote;
}

function toIx(j: IxJson): TransactionInstruction {
  return new TransactionInstruction({ programId: new PublicKey(j.programId), keys: j.accounts.map((a) => ({ pubkey: new PublicKey(a.pubkey), isSigner: a.isSigner, isWritable: a.isWritable })), data: Buffer.from(j.data, "base64") });
}

export async function jupiterSwapInstructions(quote: JupiterQuote, user: PublicKey): Promise<JupiterSwapIxs> {
  const res = await fetch(`${HOST}/swap-instructions`, { method: "POST", headers: HEADERS, body: JSON.stringify({ quoteResponse: quote, userPublicKey: user.toBase58(), wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true }), signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`jupiter swap-instructions: HTTP ${res.status} ${(await res.text()).slice(0, 160)}`);
  const j = (await res.json()) as { computeBudgetInstructions: IxJson[]; setupInstructions: IxJson[]; swapInstruction: IxJson; cleanupInstruction: IxJson | null; addressLookupTableAddresses: string[]; computeUnitLimit: number; error?: string };
  if (j.error) throw new Error(`jupiter: ${j.error}`);
  return { computeBudget: j.computeBudgetInstructions.map(toIx), setup: j.setupInstructions.map(toIx), swap: toIx(j.swapInstruction), cleanup: j.cleanupInstruction ? toIx(j.cleanupInstruction) : null, lookupTables: j.addressLookupTableAddresses.map((a) => new PublicKey(a)), computeUnitLimit: j.computeUnitLimit };
}
