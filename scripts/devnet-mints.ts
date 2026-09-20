import "./env-load";
/*
 * Devnet replicas of the mints the product trades.
 *
 * xStocks and PreStocks tokens exist on mainnet only, so a devnet deployment has nothing real to escrow.
 * This creates mints that reproduce what the program actually has to handle: Token-2022, the same decimals, the same
 * extension set (scaled UI amount at the issuer's live multiplier, pausable, default account state, permanent
 * delegate, a transfer hook slot with no program) and, for the First Print replica, the same 20 bps transfer fee.
 * The rights profile the app shows is therefore the real one, and every escrow path is the same code.
 *
 * The marks stay real: the registry prices a replica from its mainnet counterpart (docs/DEVNET.md), so the numbers on
 * screen are the market's, not invented. Mint authority stays with the deployer so the faucet can hand tokens out.
 *
 * Idempotent: mints already recorded in fixtures/devnet-mints.json and present on chain are left alone.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
  AccountState, ExtensionType, LENGTH_SIZE, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, TYPE_SIZE, createInitializeDefaultAccountStateInstruction,
  createInitializeMetadataPointerInstruction, createInitializeMint2Instruction, createInitializePausableConfigInstruction,
  createInitializePermanentDelegateInstruction, createInitializeScaledUiAmountConfigInstruction, createInitializeTransferFeeConfigInstruction,
  createInitializeTransferHookInstruction, getMintLen,
} from "@solana/spl-token";
import { createInitializeInstruction, pack, type TokenMetadata } from "@solana/spl-token-metadata";
import { sendRawAndConfirm } from "../packages/sdk/src";
import { loadOrCreateKey, onChainMultiplier, xstockMultiplier } from "./fork-lib";
import { prestocksTokens } from "../packages/registry/src";

const RPC = process.env.DEVNET_RPC_URL ?? "https://api.devnet.solana.com";
const QUOTE_DECIMALS = 6;
const OUT = resolve(process.cwd(), "fixtures/devnet-mints.json");

/** One replica per market we want live on devnet: the launch set plus one fee mint for First Print. */
const XSTOCKS = [
  { symbol: "NVDAx", underlying: "NVDA", name: "NVIDIA xStock" },
  { symbol: "TSLAx", underlying: "TSLA", name: "Tesla xStock" },
  { symbol: "SPYx", underlying: "SPY", name: "SP500 xStock" },
  { symbol: "AAPLx", underlying: "AAPL", name: "Apple xStock" },
  { symbol: "MSFTx", underlying: "MSFT", name: "Microsoft xStock" },
  { symbol: "GOOGLx", underlying: "GOOGL", name: "Alphabet xStock" },
];
/**
 * PreStocks replicas: OPENAI and SPACEX by default (the two with a mainnet inspection and escrow proof in the
 * registry), every token the issuer lists with `--all`. Mints and names come from the issuer's API; the multiplier is
 * read from the real mint on mainnet, because the issuer prices per share and the token carries a scaled UI amount
 * (OPENAI 1.486, SPACEX 5 on 2026-09-20): a replica at 1 would put every strike off by that factor.
 */
const PRESTOCKS_DEFAULT = ["OPENAI", "SPACEX"];
const PRESTOCKS_FEE_BPS = 50;
const MAINNET_RPC = process.env.MAINNET_RPC_URL ?? process.env.FORK_DATASOURCE_URL ?? "https://api.mainnet-beta.solana.com";

export interface DevnetMint {
  symbol: string;
  name: string;
  underlyingSymbol: string;
  mint: string;
  decimals: number;
  wrapper: "xStock" | "PreStocks";
  /** The mainnet mint this replica stands in for: where its mark comes from. */
  mainnetMint: string | null;
  multiplier: number;
  feeBps: number;
  createdAt: string;
}
export interface DevnetMints { cluster: "devnet"; quoteMint: string; quoteDecimals: number; authority: string; mints: DevnetMint[] }

/** Poll the signature rather than trust the provider's block height: devnet transactions here land after web3 gives up. */
async function send(conn: Connection, tx: Transaction, signers: Keypair[]): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = signers[0]!.publicKey;
  tx.sign(...signers);
  return sendRawAndConfirm(conn, tx.serialize(), lastValidBlockHeight, "confirmed");
}

function read(): DevnetMints | null {
  return existsSync(OUT) ? (JSON.parse(readFileSync(OUT, "utf8")) as DevnetMints) : null;
}

function write(f: DevnetMints): void {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(f, null, 2)}\n`);
}

/** A Token-2022 mint carrying exactly the extensions the real xStocks mints carry (docs/MINT.md). */
async function createXstockReplica(conn: Connection, payer: Keypair, spec: { symbol: string; name: string }, multiplier: number): Promise<PublicKey> {
  const mint = Keypair.generate();
  const decimals = 8;
  const metadata: TokenMetadata = {
    mint: mint.publicKey,
    name: `${spec.name} (devnet replica)`,
    symbol: spec.symbol,
    uri: "https://roster.finance/devnet",
    additionalMetadata: [["replicaOf", "xStocks mainnet mint"]],
  };
  // The metadata lives in the mint account itself, so the account must be sized for it up front.
  const base = getMintLen([ExtensionType.MetadataPointer, ExtensionType.PermanentDelegate, ExtensionType.DefaultAccountState, ExtensionType.ScaledUiAmountConfig, ExtensionType.PausableConfig, ExtensionType.TransferHook]);
  const space = base + TYPE_SIZE + LENGTH_SIZE + pack(metadata).length;
  const tx = new Transaction().add(
    SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: mint.publicKey, space: base, lamports: await conn.getMinimumBalanceForRentExemption(space), programId: TOKEN_2022_PROGRAM_ID }),
    createInitializeMetadataPointerInstruction(mint.publicKey, payer.publicKey, mint.publicKey, TOKEN_2022_PROGRAM_ID),
    createInitializePermanentDelegateInstruction(mint.publicKey, payer.publicKey, TOKEN_2022_PROGRAM_ID),
    createInitializeDefaultAccountStateInstruction(mint.publicKey, AccountState.Initialized, TOKEN_2022_PROGRAM_ID),
    createInitializeScaledUiAmountConfigInstruction(mint.publicKey, payer.publicKey, multiplier, TOKEN_2022_PROGRAM_ID),
    createInitializePausableConfigInstruction(mint.publicKey, payer.publicKey, TOKEN_2022_PROGRAM_ID),
    // The real xStocks mints carry the hook slot with an all-zero program id, which the program reads as no hook.
    createInitializeTransferHookInstruction(mint.publicKey, payer.publicKey, PublicKey.default, TOKEN_2022_PROGRAM_ID),
    createInitializeMint2Instruction(mint.publicKey, decimals, payer.publicKey, null, TOKEN_2022_PROGRAM_ID),
    createInitializeInstruction({ programId: TOKEN_2022_PROGRAM_ID, mint: mint.publicKey, metadata: mint.publicKey, name: metadata.name, symbol: metadata.symbol, uri: metadata.uri, mintAuthority: payer.publicKey, updateAuthority: payer.publicKey }),
  );
  await send(conn, tx, [payer, mint]);
  return mint.publicKey;
}

/**
 * The PreStocks replica: the extension set the real mints carry (docs/ELIGIBILITY.md, registry.json inspection):
 * permanent delegate, default account state initialized, a 50 bps transfer fee with no cap, scaled UI amount at the
 * mainnet multiplier, pausable, and the hook slot with no program. Nine decimals, as on mainnet. The confidential
 * transfer extensions are not replicated: the program never makes a confidential transfer.
 */
async function createPreStocksReplica(conn: Connection, payer: Keypair, spec: { symbol: string; name: string; mainnetMint: string; feeBps: number }, multiplier: number): Promise<PublicKey> {
  const mint = Keypair.generate();
  const decimals = 9;
  const metadata: TokenMetadata = { mint: mint.publicKey, name: `${spec.name} (devnet replica)`, symbol: spec.symbol, uri: "https://roster.finance/devnet", additionalMetadata: [["replicaOf", spec.mainnetMint]] };
  const base = getMintLen([ExtensionType.MetadataPointer, ExtensionType.PermanentDelegate, ExtensionType.DefaultAccountState, ExtensionType.TransferFeeConfig, ExtensionType.ScaledUiAmountConfig, ExtensionType.PausableConfig, ExtensionType.TransferHook]);
  const space = base + TYPE_SIZE + LENGTH_SIZE + pack(metadata).length;
  const tx = new Transaction().add(
    SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: mint.publicKey, space: base, lamports: await conn.getMinimumBalanceForRentExemption(space), programId: TOKEN_2022_PROGRAM_ID }),
    createInitializeMetadataPointerInstruction(mint.publicKey, payer.publicKey, mint.publicKey, TOKEN_2022_PROGRAM_ID),
    createInitializePermanentDelegateInstruction(mint.publicKey, payer.publicKey, TOKEN_2022_PROGRAM_ID),
    createInitializeDefaultAccountStateInstruction(mint.publicKey, AccountState.Initialized, TOKEN_2022_PROGRAM_ID),
    createInitializeTransferFeeConfigInstruction(mint.publicKey, payer.publicKey, payer.publicKey, spec.feeBps, BigInt("18446744073709551615"), TOKEN_2022_PROGRAM_ID),
    createInitializeScaledUiAmountConfigInstruction(mint.publicKey, payer.publicKey, multiplier, TOKEN_2022_PROGRAM_ID),
    createInitializePausableConfigInstruction(mint.publicKey, payer.publicKey, TOKEN_2022_PROGRAM_ID),
    createInitializeTransferHookInstruction(mint.publicKey, payer.publicKey, PublicKey.default, TOKEN_2022_PROGRAM_ID),
    createInitializeMint2Instruction(mint.publicKey, decimals, payer.publicKey, null, TOKEN_2022_PROGRAM_ID),
    createInitializeInstruction({ programId: TOKEN_2022_PROGRAM_ID, mint: mint.publicKey, metadata: mint.publicKey, name: metadata.name, symbol: metadata.symbol, uri: metadata.uri, mintAuthority: payer.publicKey, updateAuthority: payer.publicKey }),
  );
  await send(conn, tx, [payer, mint]);
  return mint.publicKey;
}

async function main(): Promise<void> {
  const conn = new Connection(RPC, "confirmed");
  const payer = loadOrCreateKey("deployer");
  const sol = (await conn.getBalance(payer.publicKey)) / 1e9;
  console.log(`[devnet] ${RPC} payer ${payer.publicKey.toBase58()} ${sol.toFixed(3)} SOL`);
  if (sol < 0.5) throw new Error(`the deployer holds ${sol.toFixed(3)} SOL on devnet; fund it before creating mints (docs/DEVNET.md)`);

  const existing = read();
  const file: DevnetMints = existing ?? { cluster: "devnet", quoteMint: "", quoteDecimals: 6, authority: payer.publicKey.toBase58(), mints: [] };
  const alive = async (a: string) => !!(await conn.getAccountInfo(new PublicKey(a)));

  // The quote mint: plain SPL Token with six decimals, as USDC is, and ours to mint so the faucet can hand it out.
  if (!file.quoteMint || !(await alive(file.quoteMint))) {
    const usdc = Keypair.generate();
    const lamports = await conn.getMinimumBalanceForRentExemption(82);
    await send(conn, new Transaction().add(
      SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: usdc.publicKey, space: 82, lamports, programId: TOKEN_PROGRAM_ID }),
      createInitializeMint2Instruction(usdc.publicKey, QUOTE_DECIMALS, payer.publicKey, null, TOKEN_PROGRAM_ID),
    ), [payer, usdc]);
    file.quoteMint = usdc.publicKey.toBase58();
    console.log(`[devnet] quote mint ${file.quoteMint}`);
    write(file);
  }

  for (const spec of XSTOCKS) {
    if (file.mints.some((m) => m.symbol === spec.symbol) && (await alive(file.mints.find((m) => m.symbol === spec.symbol)!.mint))) continue;
    // The replica starts at the issuer's live multiplier, so share terms read the same as they do on mainnet.
    const live = await xstockMultiplier(spec.symbol).catch(() => null);
    const multiplier = live?.currentMultiplier && live.currentMultiplier > 0 ? live.currentMultiplier : 1;
    const mint = await createXstockReplica(conn, payer, spec, multiplier);
    file.mints = file.mints.filter((m) => m.symbol !== spec.symbol);
    file.mints.push({ symbol: spec.symbol, name: spec.name, underlyingSymbol: spec.underlying, mint: mint.toBase58(), decimals: 8, wrapper: "xStock", mainnetMint: null, multiplier, feeBps: 0, createdAt: new Date().toISOString() });
    write(file);
    console.log(`[devnet] ${spec.symbol} ${mint.toBase58()} multiplier ${multiplier}`);
  }

  const wanted = process.argv.includes("--all") ? null : new Set([...PRESTOCKS_DEFAULT, ...process.argv.slice(2).filter((a) => !a.startsWith("--"))]);
  const mainnet = new Connection(MAINNET_RPC, "confirmed");
  for (const t of (await prestocksTokens()).filter((t) => !wanted || wanted.has(t.symbol))) {
    if (file.mints.some((m) => m.symbol === t.symbol) && (await alive(file.mints.find((m) => m.symbol === t.symbol)!.mint))) continue;
    const multiplier = await onChainMultiplier(mainnet, new PublicKey(t.mint));
    const mint = await createPreStocksReplica(conn, payer, { symbol: t.symbol, name: t.name, mainnetMint: t.mint, feeBps: PRESTOCKS_FEE_BPS }, multiplier);
    file.mints = file.mints.filter((m) => m.symbol !== t.symbol);
    file.mints.push({ symbol: t.symbol, name: t.name, underlyingSymbol: t.name, mint: mint.toBase58(), decimals: 9, wrapper: "PreStocks", mainnetMint: t.mint, multiplier, feeBps: PRESTOCKS_FEE_BPS, createdAt: new Date().toISOString() });
    write(file);
    console.log(`[devnet] ${t.symbol} ${mint.toBase58()} replica of ${t.mint} multiplier ${multiplier} fee ${PRESTOCKS_FEE_BPS} bps`);
  }

  console.log(`[devnet] ${file.mints.length} replicas and the quote mint in ${OUT}`);
}

await main();
