import "server-only";
import { Connection, PublicKey, type Transaction } from "@solana/web3.js";
import { RosterClient, readOnlyWallet, sendRawAndConfirm } from "@roster/sdk";

/*
 * Transactions are built here, signed in the browser wallet, and submitted here through the app's own RPC
 * (CLAUDE.md 4.4). The wallet's network setting never matters; the RPC key never reaches the browser.
 */

export const RPC_URL = process.env.RPC_URL ?? process.env.FORK_RPC_URL ?? "http://127.0.0.1:8899";

export function connection(): Connection {
  return new Connection(RPC_URL, "confirmed");
}

export type TxKind = "buy" | "exercise" | "quote" | "cancel_ask" | "withdraw_unsold" | "claim_premium" | "settle_writer" | "enable_auto_exercise" | "disable_auto_exercise";

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

export async function sendSigned(signedBase64: string, lastValidBlockHeight: number): Promise<string> {
  return sendRawAndConfirm(connection(), Buffer.from(signedBase64, "base64"), lastValidBlockHeight);
}
