import { NextResponse } from "next/server";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, createMintToInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";

export const dynamic = "force-dynamic";

/*
 * Devnet test funds. The replica mints keep their authority with the deployer (docs/DEVNET.md), so the faucet is an
 * ordinary `mintTo`: a wallet asks once, gets every listed token and the quote token, and can trade immediately.
 *
 * Devnet only, by two independent checks: the cluster must say devnet and the mints file must exist. Nothing here can
 * run against mainnet, where these mints do not exist and the authority is not ours.
 */
const PER_WALLET_MS = 10 * 60 * 1000;
const TOKENS_EACH = 25;
const QUOTE_EACH = 25_000;
/* Enough lamports to sign for a long session: the faucet pays for the token accounts, the wallet pays its own fees
 * and the accounts its own positions need. */
const SOL_EACH = 0.01;
const recent = new Map<string, number>();

interface DevnetMint { symbol: string; mint: string; decimals: number }
interface DevnetMints { cluster: string; quoteMint: string; quoteDecimals: number; mints: DevnetMint[] }

function mints(): DevnetMints | null {
  const p = resolve(process.cwd(), "../../fixtures/devnet-mints.json");
  const local = resolve(process.cwd(), "fixtures/devnet-mints.json");
  const file = existsSync(p) ? p : existsSync(local) ? local : null;
  return file ? (JSON.parse(readFileSync(file, "utf8")) as DevnetMints) : null;
}

function authority(): Keypair | null {
  const path = process.env.DEPLOYER_KEYPAIR ?? "../../.keys/deployer.json";
  const p = resolve(process.cwd(), path);
  if (!existsSync(p)) return null;
  return Keypair.fromSecretKey(new Uint8Array(JSON.parse(readFileSync(p, "utf8")) as number[]));
}

export async function POST(req: Request) {
  if (process.env.NEXT_PUBLIC_CLUSTER !== "devnet") return NextResponse.json({ error: "the faucet runs on devnet only" }, { status: 400 });
  const d = mints();
  const payer = authority();
  if (!d || !payer) return NextResponse.json({ error: "this deployment holds no devnet mints" }, { status: 503 });

  const body = (await req.json().catch(() => null)) as { wallet?: unknown } | null;
  if (!body || typeof body.wallet !== "string") return NextResponse.json({ error: "send { wallet }" }, { status: 400 });
  let owner: PublicKey;
  try {
    owner = new PublicKey(body.wallet);
  } catch {
    return NextResponse.json({ error: "that is not a wallet address" }, { status: 400 });
  }

  const key = owner.toBase58();
  const last = recent.get(key) ?? 0;
  const wait = PER_WALLET_MS - (Date.now() - last);
  if (wait > 0) return NextResponse.json({ error: `already funded; ask again in ${Math.ceil(wait / 60_000)} minutes` }, { status: 429 });

  const connection = new Connection(process.env.RPC_URL ?? "https://api.devnet.solana.com", "confirmed");
  // A few tokens per transaction: creating an account and minting for eight mints at once does not fit in one, and a
  // faucet that fails on its last leg has funded nobody.
  const legs: { mint: PublicKey; program: PublicKey; raw: bigint }[] = [
    { mint: new PublicKey(d.quoteMint), program: TOKEN_PROGRAM_ID, raw: BigInt(QUOTE_EACH) * 10n ** BigInt(d.quoteDecimals) },
    ...d.mints.map((m) => ({ mint: new PublicKey(m.mint), program: TOKEN_2022_PROGRAM_ID, raw: BigInt(TOKENS_EACH) * 10n ** BigInt(m.decimals) })),
  ];
  const batches: Transaction[] = [];
  for (let i = 0; i < legs.length; i += 3) {
    const tx = new Transaction();
    for (const leg of legs.slice(i, i + 3)) {
      const ata = getAssociatedTokenAddressSync(leg.mint, owner, true, leg.program);
      tx.add(createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, ata, owner, leg.mint, leg.program));
      tx.add(createMintToInstruction(leg.mint, ata, payer.publicKey, leg.raw, [], leg.program));
    }
    batches.push(tx);
  }
  // A wallet holding tokens and no lamports cannot sign anything, so the fee money goes in the first transaction.
  const balance = await connection.getBalance(owner, "confirmed").catch(() => 0);
  const want = Math.round(SOL_EACH * LAMPORTS_PER_SOL);
  if (balance < want) batches[0]!.add(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: owner, lamports: want - balance }));

  const signatures: string[] = [];
  try {
    for (const tx of batches) {
      const { blockhash } = await connection.getLatestBlockhash("confirmed");
      tx.recentBlockhash = blockhash;
      tx.feePayer = payer.publicKey;
      tx.sign(payer);
      signatures.push(await connection.sendRawTransaction(tx.serialize(), { preflightCommitment: "confirmed" }));
    }
  } catch (e) {
    return NextResponse.json({ error: `the faucet transaction failed: ${(e as Error).message.split("\n")[0]}`, signatures }, { status: 502 });
  }
  recent.set(key, Date.now());
  return NextResponse.json({ signature: signatures[0], signatures, tokens: TOKENS_EACH, quote: QUOTE_EACH, sol: SOL_EACH, mints: d.mints.map((m) => m.symbol) });
}
