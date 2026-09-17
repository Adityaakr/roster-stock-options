import "server-only";
import { AddressLookupTableAccount, ComputeBudgetProgram, Connection, PublicKey, TransactionMessage, VersionedTransaction, type Transaction } from "@solana/web3.js";
import { RosterClient, readOnlyWallet, sendRawAndConfirm } from "@roster/sdk";
import { jupiterQuote, jupiterSwapInstructions, type JupiterQuote } from "./jupiter";

/*
 * Transactions are built here, signed in the browser wallet, and submitted here through the app's own RPC
 * (CLAUDE.md 4.4). The wallet's network setting never matters; the RPC key never reaches the browser.
 */

export const RPC_URL = process.env.RPC_URL ?? process.env.FORK_RPC_URL ?? "http://127.0.0.1:8899";

export function connection(): Connection {
  return new Connection(RPC_URL, "confirmed");
}

export type TxKind = "buy" | "exercise" | "quote" | "cancel_ask" | "withdraw_unsold" | "claim_premium" | "settle_writer" | "enable_auto_exercise" | "disable_auto_exercise" | "protected_buy";

export interface BuildRequest {
  kind: TxKind;
  wallet: string;
  /** The market's underlying mint and the series account. */
  mint: string;
  series: string;
  params?: Record<string, string | number | null>;
}

export interface BuildResponse {
  /** Base64 of the unsigned transaction, fee payer and blockhash set. */
  transaction: string;
  lastValidBlockHeight: number;
  summary: string;
}

const str = (p: Record<string, string | number | null> | undefined, k: string): string => {
  const v = p?.[k];
  if (v === undefined || v === null) throw new Error(`missing ${k}`);
  return String(v);
};

export async function buildTransaction(req: BuildRequest): Promise<BuildResponse> {
  const wallet = new PublicKey(req.wallet);
  const client = new RosterClient(connection(), readOnlyWallet(wallet));
  if (req.kind === "protected_buy") return buildProtectedBuy(client, wallet, req);
  const market = await client.fetchMarket(new PublicKey(req.mint));
  if (!market) throw new Error("market not listed");
  const series = await client.fetchSeries(new PublicKey(req.series));
  if (!series) throw new Error("series not found: it may have closed");
  let tx: Transaction;
  let summary: string;
  const p = req.params;
  switch (req.kind) {
    case "buy": {
      const lots6 = BigInt(str(p, "lots6"));
      const max = BigInt(str(p, "maxPremiumPerLot"));
      const referrer = p?.referrer ? new PublicKey(String(p.referrer)) : null;
      tx = await client.buy(market, series, lots6, max, referrer);
      summary = `buy ${Number(lots6) / 1e6} lots at up to ${Number(max) / 1e6} USDC per lot`;
      break;
    }
    case "exercise": {
      const lots6 = BigInt(str(p, "lots6"));
      tx = await client.exercise(market, series, lots6);
      summary = `exercise ${Number(lots6) / 1e6} lots`;
      break;
    }
    case "quote": {
      const deposit = BigInt(str(p, "depositLots6"));
      const ask = BigInt(str(p, "askLots6"));
      const per = BigInt(str(p, "askPerLot"));
      tx = await client.quote(market, series, deposit, ask, per);
      summary = `deposit ${Number(deposit) / 1e6} lots and ask ${Number(per) / 1e6} USDC per lot on ${Number(ask) / 1e6} lots`;
      break;
    }
    case "cancel_ask":
      tx = await client.cancelAsk(series, BigInt(str(p, "seq")));
      summary = "cancel ask";
      break;
    case "withdraw_unsold":
      tx = await client.withdrawUnsold(market, series, BigInt(str(p, "lots6")));
      summary = "withdraw unsold collateral";
      break;
    case "claim_premium":
      tx = await client.claimPremium(market, series);
      summary = "claim premium";
      break;
    case "settle_writer":
      tx = await client.settleWriter(market, series, wallet);
      summary = "settle after expiry";
      break;
    case "enable_auto_exercise":
      tx = await client.enableAutoExercise(market, series, Number(p?.minItmBps ?? 0));
      summary = "enable auto-exercise";
      break;
    case "disable_auto_exercise":
      tx = await client.disableAutoExercise(market, series);
      summary = "disable auto-exercise";
      break;
    default:
      throw new Error(`unknown transaction kind ${String(req.kind)}`);
  }
  const prepared = await client.prepare(tx);
  return { transaction: prepared.tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"), lastValidBlockHeight: prepared.lastValidBlockHeight, summary };
}

/**
 * The series of a market read from chain right now, merged over the indexer's rows (which keep the vault balances the
 * program accounts do not carry). Used when a screen needs the state a transaction just changed.
 */
export async function freshSeries<T extends { address: string; asks: unknown[]; writers: unknown[]; total_sold_lots6: string; total_exercised_lots6: string; unassigned_lots6: string; halted: number }>(market: string, rows: T[]): Promise<T[]> {
  const client = new RosterClient(connection(), readOnlyWallet(PublicKey.default));
  const live = await client.fetchSeriesForMarket(new PublicKey(market));
  const byAddr = new Map(live.map((s) => [s.address.toBase58(), s]));
  return rows.map((row) => {
    const s = byAddr.get(row.address);
    if (!s) return row;
    return {
      ...row,
      total_sold_lots6: s.totalSoldLots6.toString(),
      total_exercised_lots6: s.totalExercisedLots6.toString(),
      unassigned_lots6: s.unassignedLots6.toString(),
      halted: s.halted ? 1 : 0,
      asks: s.asks.map((a) => ({ remaining_lots6: a.remainingLots6.toString(), ask_per_lot: a.askPerLot.toString(), seq: a.seq.toString(), writer_slot: a.writerSlot })),
      writers: s.writers.map((w) => ({ writer: w.writer.toBase58(), deposited_lots6: w.depositedLots6.toString(), withdrawn_lots6: w.withdrawnLots6.toString(), sold_lots6: w.soldLots6.toString(), open_lots6: w.openLots6.toString(), assigned_lots6: w.assignedLots6.toString(), premium_claimable: w.premiumClaimable.toString(), settled: w.settled }))
    };
  });
}

/** What a Protected Buy would do for `usdcIn`: the swap's tokens out and the floor's cost on them, for the desk's figures. */
export async function protectedBuyQuote(mint: string, usdcIn: bigint, slippageBps = 50): Promise<{ quote: JupiterQuote; tokensOutRaw: bigint; minOutRaw: bigint; route: string }> {
  const q = await jupiterQuote(USDC.toBase58(), mint, usdcIn, slippageBps);
  return { quote: q, tokensOutRaw: BigInt(q.outAmount), minOutRaw: BigInt(q.otherAmountThreshold), route: q.routePlan.map((r) => r.swapInfo.label).join(" > ") };
}

const USDC = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

/**
 * Protected Buy (CLAUDE.md 5): a Jupiter swap USDC -> token and a `buy` of a Floor on the tokens received, in one
 * versioned transaction. The floor covers the swap's minimum out (worst case under slippage), rounded down to the
 * program's lot granularity, so every token that can arrive is covered.
 */
async function buildProtectedBuy(client: RosterClient, wallet: PublicKey, req: BuildRequest): Promise<BuildResponse> {
  const conn = client.provider.connection;
  const usdcIn = BigInt(str(req.params, "usdcIn"));
  const slippage = Number(req.params?.slippageBps ?? 50);
  const market = await client.fetchMarket(new PublicKey(req.mint));
  if (!market) throw new Error("market not listed");
  const series = req.series ? await client.fetchSeries(new PublicKey(req.series)) : null;
  if (req.series && !series) throw new Error("floor series not found");
  if (series && series.side !== "put") throw new Error("the floor must be a put series");
  // A route can fail in simulation for reasons the quote cannot see (a pool whose oracle read is stale, for one); the
  // failing venue is excluded and the next route tried, twice, before giving up with the simulation's own words.
  const excluded: string[] = [];
  let lastError = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    const q = await jupiterQuote(USDC.toBase58(), req.mint, usdcIn, slippage, excluded);
    const swap = await jupiterSwapInstructions(q, wallet);
    const ixs = [...swap.setup, swap.swap, ...(swap.cleanup ? [swap.cleanup] : [])];
    const venues = q.routePlan.map((r) => r.swapInfo.label);
    let summary = `swap ${Number(usdcIn) / 1e6} USDC for about ${Number(q.outAmount) / 10 ** market.decimals} ${market.symbol} via ${venues.join(" > ")}`;
    if (series) {
      // Lots (1e6 per token) from the minimum tokens out, floored to the market's minimum size granularity.
      const raw = BigInt(q.otherAmountThreshold);
      const lots6 = (raw * 1_000_000n) / 10n ** BigInt(market.decimals);
      const min = market.minLots6;
      const rounded = (lots6 / min) * min;
      if (rounded < min) throw new Error(`too small to protect: ${Number(lots6) / 1e6} lots is under the market minimum ${Number(min) / 1e6}`);
      const max = BigInt(str(req.params, "maxPremiumPerLot"));
      const buy = await client.buy(market, series, rounded, max);
      ixs.push(...buy.instructions);
      summary += `; buy a floor on ${Number(rounded) / 1e6} lots at up to ${Number(max) / 1e6} USDC per lot`;
    }
    const tables = (await Promise.all(swap.lookupTables.map((k) => conn.getAddressLookupTable(k)))).map((r) => r.value).filter((v): v is AddressLookupTableAccount => !!v);
    const latest = await conn.getLatestBlockhash("confirmed");
    const message = new TransactionMessage({ payerKey: wallet, recentBlockhash: latest.blockhash, instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: Math.min(1_400_000, swap.computeUnitLimit + 200_000) }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: client.priorityMicroLamports }), ...ixs] }).compileToV0Message(tables);
    const tx = new VersionedTransaction(message);
    const sim = await conn.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true });
    if (!sim.value.err) return { transaction: Buffer.from(tx.serialize()).toString("base64"), lastValidBlockHeight: latest.lastValidBlockHeight, summary };
    const logs = sim.value.logs ?? [];
    const swapFailed = logs.some((l) => l.includes("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4 failed"));
    const anchorLine = logs.find((l) => l.includes("AnchorError")) ?? logs.filter((l) => l.startsWith("Program log:")).slice(-1)[0] ?? JSON.stringify(sim.value.err);
    lastError = anchorLine;
    if (!swapFailed) throw new Error(`Simulation failed. ${anchorLine}`);
    excluded.push(...venues.filter((v) => !excluded.includes(v)));
  }
  throw new Error(`no swap route survived simulation (tried excluding ${excluded.join(", ")}): ${lastError}`);
}

export async function sendSigned(signedBase64: string, lastValidBlockHeight: number): Promise<string> {
  return sendRawAndConfirm(connection(), Buffer.from(signedBase64, "base64"), lastValidBlockHeight);
}
