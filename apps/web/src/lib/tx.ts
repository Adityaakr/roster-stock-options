"use client";

import { useCallback, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Transaction, VersionedTransaction } from "@solana/web3.js";

/*
 * The one way a transaction happens in the app: the server builds it, the wallet signs it, the server submits it
 * (CLAUDE.md 4.4). Every failure is turned into what happened and the next action (Part 2 section 6, Act).
 */

export type TxKind = "buy" | "exercise" | "quote" | "cancel_ask" | "withdraw_unsold" | "claim_premium" | "settle_writer" | "enable_auto_exercise" | "disable_auto_exercise" | "protected_buy" | "vault_deposit" | "vault_request_withdraw" | "vault_claim" | "sell_to_vault";

export interface TxRequest {
  kind: TxKind;
  mint: string;
  /** Empty for the vault's depositor instructions, which name a vault kind in `params` instead. */
  series: string;
  params?: Record<string, string | number | null>;
}

export interface TxFailure {
  /** What happened, in plain words. */
  what: string;
  /** The next action. */
  next: string;
  /** A stable code for tests and logs. */
  code: "quote_moved" | "insufficient_usdc" | "insufficient_tokens" | "paused" | "halted" | "hook" | "rejected" | "expired" | "rpc" | "not_deployed" | "size" | "other";
}

export type TxState = { status: "idle" } | { status: "building" } | { status: "signing" } | { status: "sending" } | { status: "done"; signature: string } | { status: "failed"; failure: TxFailure };

/** Map program and RPC errors to the taxonomy. The program's own error names are the most reliable signal. */
export function classify(message: string): TxFailure {
  const m = message;
  const has = (s: string) => m.includes(s);
  if (has("QuoteMoved") || has("nothing could be filled")) return { code: "quote_moved", what: "The quote moved before the transaction landed: nothing could be filled at or below your limit.", next: "The quote has been refreshed. Check the new premium and buy again." };
  if (has("insufficient funds") || has("InsufficientFunds") || has("0x1") && has("Transfer")) return { code: "insufficient_usdc", what: "The wallet does not hold enough to pay for this.", next: "Top up USDC (or the token, for a Floor) and try again." };
  if (has("InsufficientPosition")) return { code: "insufficient_tokens", what: "The wallet holds fewer position tokens than the size entered.", next: "Enter a size at or below what you hold." };
  if (has("Paused") || has("is paused") || has("MintPaused")) return { code: "paused", what: "The market or the underlying token is paused by its issuer.", next: "Nothing can be signed until it resumes. Positions keep their rights; expiry extends by the halt rule." };
  if (has("Halted")) return { code: "halted", what: "This series is halted: the issuer paused or froze the token.", next: "Wait for the issuer to resume. Expiry extends 24 hours past the resume so nothing is lost to the halt." };
  if (has("TransferHook") || has("hook")) return { code: "hook", what: "The token's transfer hook rejected the transfer.", next: "This mint enforces rules outside the program. Check the issuer's terms for this wallet." };
  if (has("SizeOutOfRange")) return { code: "size", what: "The size is outside the market's limits.", next: "Pick a size within the minimum and maximum shown on the term." };
  if (has("Expired") || has("NotExpired") || has("block height exceeded")) return { code: "expired", what: has("block height") ? "The transaction expired before the network saw it." : "The series has expired.", next: has("block height") ? "The network was congested. Try again." : "Expired positions settle by the rules on the term; nothing more to sign." };
  if (has("User rejected") || has("rejected the request") || has("WalletSignTransactionError")) return { code: "rejected", what: "The wallet declined to sign.", next: "Nothing was sent. Sign to continue." };
  if (has("not deployed") || has("program that does not exist") || has("ProgramAccountNotFound")) return { code: "not_deployed", what: "The program is not deployed on this cluster.", next: "Nothing can be signed here." };
  if (has("fetch") || has("429") || has("503") || has("timeout") || has("Blockhash not found")) return { code: "rpc", what: "The RPC did not answer in time.", next: "Wait a moment and try again; the transaction was not sent twice." };
  return { code: "other", what: m.length > 220 ? m.slice(0, 220) + "…" : m, next: "Try again. If it repeats, the reason above names the program's check that failed." };
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
  return j;
}

export function useTransaction(): { state: TxState; run: (req: TxRequest) => Promise<string | null>; reset: () => void } {
  const { publicKey, signTransaction } = useWallet();
  const [state, setState] = useState<TxState>({ status: "idle" });
  const run = useCallback(async (req: TxRequest) => {
    if (!publicKey || !signTransaction) {
      setState({ status: "failed", failure: { code: "rejected", what: "No wallet is connected.", next: "Connect a wallet that can sign." } });
      return null;
    }
    try {
      setState({ status: "building" });
      const built = await post<{ transaction: string; lastValidBlockHeight: number }>("/api/tx/build", { ...req, wallet: publicKey.toBase58() });
      setState({ status: "signing" });
      const bytes = Buffer.from(built.transaction, "base64");
      // A serialized transaction is [signature count][signatures][message]; a versioned message (Protected Buy, with
      // lookup tables) starts with a version prefix byte with the high bit set, a legacy message does not.
      const sigs = bytes[0]!;
      const versioned = (bytes[1 + 64 * sigs]! & 0x80) !== 0;
      const tx = versioned ? VersionedTransaction.deserialize(bytes) : Transaction.from(bytes);
      const signed = await signTransaction(tx);
      setState({ status: "sending" });
      const { signature } = await post<{ signature: string }>("/api/tx/send", { signed: Buffer.from(signed.serialize()).toString("base64"), lastValidBlockHeight: built.lastValidBlockHeight });
      setState({ status: "done", signature });
      return signature;
    } catch (e) {
      setState({ status: "failed", failure: classify(e instanceof Error ? e.message : String(e)) });
      return null;
    }
  }, [publicKey, signTransaction]);
  const reset = useCallback(() => setState({ status: "idle" }), []);
  return { state, run, reset };
}
