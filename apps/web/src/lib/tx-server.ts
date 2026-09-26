import { failoverFetch, rpcEndpoints } from "@roster/core";
import { SERVICES_URL } from "./services";
import "server-only";
import { createHash } from "node:crypto";
import { AddressLookupTableAccount, ComputeBudgetProgram, Connection, PublicKey, Transaction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { RosterClient, ROSTER_PROGRAM_ID, readOnlyWallet, sendRawAndConfirm } from "@roster/sdk";
import { jupiterQuote, jupiterSwapInstructions, type JupiterQuote } from "./jupiter";

/*
 * Transactions are built here, signed in the browser wallet, and submitted here through the app's own RPC
 * (CLAUDE.md 4.4). The wallet's network setting never matters; the RPC key never reaches the browser.
 */

export const RPC_URL = process.env.RPC_URL ?? process.env.FORK_RPC_URL ?? "http://127.0.0.1:8899";

const JUPITER_PROGRAM = new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");

/**
 * One connection per server process, so the failover's pacing and its memory of which endpoint answers are shared by
 * every request. Every read is bounded at eight seconds per attempt, and web3's own rate-limit retry loop (which
 * doubles its wait up to eight seconds, five times) is off: the failover already retries a 429 briefly and moves on.
 */
let shared: Connection | null = null;
export function connection(): Connection {
  shared ??= new Connection(RPC_URL, { commitment: "confirmed", disableRetryOnRateLimit: true, fetch: failoverFetch(rpcEndpoints(RPC_URL, process.env.NEXT_PUBLIC_CLUSTER ?? null, servicesRelay()), 8_000) });
  return shared;
}

/** The services' relay, when the services are remote: their keyed endpoint carries this app's reads if its own fail. */
export function servicesRelay(): string | null {
  return /^https?:\/\//.test(SERVICES_URL) && !/127\.0\.0\.1|localhost/.test(SERVICES_URL) ? `${SERVICES_URL.replace(/\/$/, "")}/v1/rpc` : null;
}

/** A market's config changes only through the authority; ten seconds of reuse spares a read on every build. */
const marketCache = new Map<string, { at: number; value: Awaited<ReturnType<RosterClient["fetchMarket"]>> }>();
async function marketOf(client: RosterClient, mint: PublicKey) {
  const k = mint.toBase58();
  const hit = marketCache.get(k);
  if (hit && hit.value && Date.now() - hit.at < 10_000) return hit.value;
  const value = await client.fetchMarket(mint);
  marketCache.set(k, { at: Date.now(), value });
  return value;
}

/** A build that has not finished in this long fails with a message that says to try again, instead of hanging. */
const BUILD_DEADLINE_MS = 25_000;
function deadline<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const h = setTimeout(() => reject(new Error("timeout: the network is busy and the transaction could not be built in time")), ms);
    p.then((v) => { clearTimeout(h); resolve(v); }, (e: unknown) => { clearTimeout(h); reject(e); });
  });
}

/**
 * The relay accepts only messages this server built: the wallet signs the exact bytes, so the signed transaction's
 * message hashes to one issued here within the last ten minutes. In-memory, per instance; a multi-instance
 * deployment needs this map in a shared store (docs/OPERATOR.md).
 */
const ISSUED_TTL_MS = 10 * 60_000;
const issued = new Map<string, number>();
function remember(messageBytes: Uint8Array): void {
  const now = Date.now();
  for (const [k, at] of issued) if (now - at > ISSUED_TTL_MS) issued.delete(k);
  issued.set(createHash("sha256").update(messageBytes).digest("hex"), now);
}
function wasIssued(messageBytes: Uint8Array): boolean {
  const at = issued.get(createHash("sha256").update(messageBytes).digest("hex"));
  return at !== undefined && Date.now() - at <= ISSUED_TTL_MS;
}

/** A u64 for the program: an integer string in range, or a plain error rather than a silently wrapped value. */
function u64(p: Record<string, string | number | null> | undefined, k: string): bigint {
  const raw = p?.[k];
  if (raw === undefined || raw === null || !/^\d+$/.test(String(raw))) throw new Error(`${k} must be a non-negative integer`);
  const v = BigInt(String(raw));
  if (v >= 2n ** 64n) throw new Error(`${k} is out of range`);
  return v;
}

export type TxKind = "buy" | "exercise" | "quote" | "cancel_ask" | "withdraw_unsold" | "claim_premium" | "settle_writer" | "enable_auto_exercise" | "disable_auto_exercise" | "protected_buy" | "vault_deposit" | "vault_request_withdraw" | "vault_claim" | "sell_to_vault";

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

const KINDS: TxKind[] = ["buy", "exercise", "quote", "cancel_ask", "withdraw_unsold", "claim_premium", "settle_writer", "enable_auto_exercise", "disable_auto_exercise", "protected_buy", "vault_deposit", "vault_request_withdraw", "vault_claim", "sell_to_vault"];

/** The request shape, checked before anything touches the RPC. */
function parseBuildRequest(body: unknown): BuildRequest {
  if (!body || typeof body !== "object") throw new Error("body must be an object");
  const b = body as Record<string, unknown>;
  if (!KINDS.includes(b.kind as TxKind)) throw new Error(`kind must be one of ${KINDS.join(", ")}`);
  for (const k of ["wallet", "mint"] as const) {
    if (typeof b[k] !== "string") throw new Error(`${k} must be a base58 address`);
    try { new PublicKey(b[k] as string); } catch { throw new Error(`${k} is not a valid address`); }
  }
  if (b.series !== undefined && b.series !== "" && (typeof b.series !== "string" || !safeKey(b.series))) throw new Error("series is not a valid address");
  if (b.params !== undefined && (b.params === null || typeof b.params !== "object" || Array.isArray(b.params))) throw new Error("params must be an object");
  return { kind: b.kind as TxKind, wallet: b.wallet as string, mint: b.mint as string, series: (b.series as string | undefined) ?? "", params: (b.params as BuildRequest["params"]) ?? {} };
}

function safeKey(s: string): boolean {
  try { new PublicKey(s); return true; } catch { return false; }
}

export function buildTransaction(body: unknown): Promise<BuildResponse> {
  return deadline(buildTransactionInner(body), BUILD_DEADLINE_MS);
}

async function buildTransactionInner(body: unknown): Promise<BuildResponse> {
  const req = parseBuildRequest(body);
  const wallet = new PublicKey(req.wallet);
  const client = new RosterClient(connection(), readOnlyWallet(wallet));
  if (req.kind === "protected_buy") return buildProtectedBuy(client, wallet, req);
  // The market and the series are read side by side; the market is reused for ten seconds.
  const [market, seriesRead] = await Promise.all([
    marketOf(client, new PublicKey(req.mint)),
    req.series && req.kind !== "vault_deposit" && req.kind !== "vault_request_withdraw" && req.kind !== "vault_claim" ? client.fetchSeries(new PublicKey(req.series)) : Promise.resolve(null)
  ]);
  if (!market) throw new Error("market not listed");
  // Part 3: the vault's depositor side needs no series, only the vault's kind.
  if (req.kind === "vault_deposit" || req.kind === "vault_request_withdraw" || req.kind === "vault_claim") {
    const kind = req.params?.kind === "cash_secured_put" ? "cash_secured_put" : "covered_call";
    const vault = await client.fetchVault(market, kind);
    if (!vault) throw new Error("no such vault on this market");
    let vtx: Transaction;
    let vsummary: string;
    if (req.kind === "vault_deposit") {
      const raw = u64(req.params, "raw");
      vtx = await client.vaultDeposit(market, kind, raw);
      vsummary = `queue ${raw} raw units of collateral for the vault's next roll`;
    } else if (req.kind === "vault_request_withdraw") {
      const shares = u64(req.params, "shares");
      vtx = await client.vaultRequestWithdraw(market, kind, shares);
      vsummary = `queue ${Number(shares) / 1e6} shares for withdrawal at the next roll`;
    } else {
      const epoch = Number(u64(req.params, "epoch"));
      vtx = await client.vaultClaim(market, kind, epoch);
      vsummary = `claim epoch ${epoch}`;
    }
    const preparedV = await client.prepare(vtx);
    remember(preparedV.tx.serializeMessage());
    return { transaction: preparedV.tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"), lastValidBlockHeight: preparedV.lastValidBlockHeight, summary: vsummary };
  }
  if (!req.series) throw new Error("series is required");
  const series = seriesRead;
  if (!series) throw new Error("series not found: it may have closed");
  if (!series.market.equals(market.address)) throw new Error("series does not belong to this market");
  let tx: Transaction;
  let summary: string;
  const p = req.params;
  switch (req.kind) {
    case "buy": {
      const lots6 = u64(p, "lots6");
      const max = u64(p, "maxPremiumPerLot");
      if (p?.referrer && !safeKey(String(p.referrer))) throw new Error("referrer is not a valid address");
      const referrer = p?.referrer ? new PublicKey(String(p.referrer)) : null;
      tx = await client.buy(market, series, lots6, max, referrer);
      summary = `buy ${Number(lots6) / 1e6} lots at up to ${Number(max) / 1e6} USDC per lot`;
      break;
    }
    case "exercise": {
      const lots6 = u64(p, "lots6");
      tx = await client.exercise(market, series, lots6);
      summary = `exercise ${Number(lots6) / 1e6} lots`;
      break;
    }
    case "quote": {
      const deposit = u64(p, "depositLots6");
      const ask = u64(p, "askLots6");
      const per = u64(p, "askPerLot");
      tx = await client.quote(market, series, deposit, ask, per);
      summary = `deposit ${Number(deposit) / 1e6} lots and ask ${Number(per) / 1e6} USDC per lot on ${Number(ask) / 1e6} lots`;
      break;
    }
    case "cancel_ask":
      tx = await client.cancelAsk(series, u64(p, "seq"));
      summary = "cancel ask";
      break;
    case "withdraw_unsold":
      tx = await client.withdrawUnsold(market, series, u64(p, "lots6"));
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
      tx = await client.enableAutoExercise(market, series, Number(u64(p, "minItmBps")));
      summary = "enable auto-exercise";
      break;
    case "disable_auto_exercise":
      tx = await client.disableAutoExercise(market, series);
      summary = "disable auto-exercise";
      break;
    case "sell_to_vault": {
      // The vault on this series' side: a call is bought back by the covered-call vault, a put by the put vault.
      const kind = series.side === "call" ? "covered_call" : "cash_secured_put";
      const lots6 = u64(p, "lots6");
      const minBid = u64(p, "minBidPerLot");
      tx = await client.sellToVault(market, kind, series, lots6, minBid);
      summary = `sell ${Number(lots6) / 1e6} lots back to the vault at no less than ${Number(minBid) / 1e6} USDC per lot`;
      break;
    }
    default:
      throw new Error(`unknown transaction kind ${String(req.kind)}`);
  }
  const prepared = await client.prepare(tx);
  remember(prepared.tx.serializeMessage());
  return { transaction: prepared.tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"), lastValidBlockHeight: prepared.lastValidBlockHeight, summary };
}

/**
 * The series of a market read from chain right now, merged over the indexer's rows (which keep the vault balances the
 * program accounts do not carry). Used when a screen needs the state a transaction just changed.
 */
export async function freshSeries<T extends { address: string; asks: unknown[]; writers: unknown[]; total_sold_lots6: string; total_exercised_lots6: string; unassigned_lots6: string; halted: number }>(market: string, rows: T[]): Promise<T[]> {
  const client = new RosterClient(connection(), readOnlyWallet(PublicKey.default));
  // The rows name every series this market has, so the accounts are read by address. A program-wide scan would be
  // both wasteful and refused: the RPC tiers most deployments run on do not serve `getProgramAccounts`.
  const live = await client.fetchSeriesMany(rows.map((r) => new PublicKey(r.address)));
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
  const usdcIn = u64(req.params, "usdcIn");
  const slippage = Math.min(500, Math.max(0, Number(u64({ slippageBps: req.params?.slippageBps ?? 50 }, "slippageBps"))));
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
      const max = u64(req.params, "maxPremiumPerLot");
      const buy = await client.buy(market, series, rounded, max);
      ixs.push(...buy.instructions);
      summary += `; buy a floor on ${Number(rounded) / 1e6} lots at up to ${Number(max) / 1e6} USDC per lot`;
    }
    const tables = (await Promise.all(swap.lookupTables.map((k) => conn.getAddressLookupTable(k)))).map((r) => r.value).filter((v): v is AddressLookupTableAccount => !!v);
    const latest = await conn.getLatestBlockhash("confirmed");
    const message = new TransactionMessage({ payerKey: wallet, recentBlockhash: latest.blockhash, instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: Math.min(1_400_000, swap.computeUnitLimit + 200_000) }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: client.priorityMicroLamports }), ...ixs] }).compileToV0Message(tables);
    const tx = new VersionedTransaction(message);
    const sim = await conn.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true });
    if (!sim.value.err) {
      remember(tx.message.serialize());
      return { transaction: Buffer.from(tx.serialize()).toString("base64"), lastValidBlockHeight: latest.lastValidBlockHeight, summary };
    }
    const logs = sim.value.logs ?? [];
    const swapFailed = logs.some((l) => l.includes("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4 failed"));
    const anchorLine = logs.find((l) => l.includes("AnchorError")) ?? logs.filter((l) => l.startsWith("Program log:")).slice(-1)[0] ?? JSON.stringify(sim.value.err);
    lastError = anchorLine;
    if (!swapFailed) throw new Error(`Simulation failed. ${anchorLine}`);
    excluded.push(...venues.filter((v) => !excluded.includes(v)));
  }
  throw new Error(`no swap route survived simulation (tried excluding ${excluded.join(", ")}): ${lastError}`);
}

/**
 * Submit a wallet-signed transaction. Only transactions that call this program (or Jupiter alongside it, for a
 * Protected Buy) are relayed: the app's RPC is not an open relay. The height bound is checked against the chain so a
 * bad value cannot hold the confirm loop open.
 */
export async function sendSigned(signedBase64: string, lastValidBlockHeight: unknown): Promise<string> {
  if (typeof signedBase64 !== "string" || signedBase64.length > 2_000) throw new Error("signed must be a base64 transaction");
  const raw = Buffer.from(signedBase64, "base64");
  const { programs, message } = programsOf(raw);
  if (!wasIssued(message)) throw new Error("only transactions this app built are relayed (build it with /api/tx/build first; a built transaction is valid for ten minutes)");
  if (!programs.some((p) => p.equals(ROSTER_PROGRAM_ID))) throw new Error("only transactions for the Roster program are relayed");
  const foreign = programs.filter((p) => !ALLOWED_PROGRAMS.some((a) => a.equals(p)));
  if (foreign.length) throw new Error(`transaction calls a program the app does not relay: ${foreign[0]!.toBase58()}`);
  const conn = connection();
  const height = await conn.getBlockHeight("confirmed");
  const lvbh = Number(lastValidBlockHeight);
  if (!Number.isFinite(lvbh) || lvbh < height - 300 || lvbh > height + 300) throw new Error("lastValidBlockHeight is not near the current block height");
  return sendRawAndConfirm(conn, raw, lvbh, "confirmed", 90_000);
}

const ALLOWED_PROGRAMS = [ROSTER_PROGRAM_ID, JUPITER_PROGRAM, ComputeBudgetProgram.programId, new PublicKey("11111111111111111111111111111111"), new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"), new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"), new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL")];

/** Program ids a serialized (legacy or v0) transaction invokes at the top level, and its message bytes. Program ids are always static keys. */
function programsOf(raw: Buffer): { programs: PublicKey[]; message: Uint8Array } {
  const sigs = raw[0] ?? 0;
  const versioned = ((raw[1 + 64 * sigs] ?? 0) & 0x80) !== 0;
  if (versioned) {
    const tx = VersionedTransaction.deserialize(raw);
    const keys = tx.message.staticAccountKeys;
    const programs = tx.message.compiledInstructions.map((ix) => keys[ix.programIdIndex]);
    if (programs.some((p) => !p)) throw new Error("a program id outside the static keys is not accepted");
    return { programs: programs as PublicKey[], message: tx.message.serialize() };
  }
  const tx = Transaction.from(raw);
  return { programs: tx.instructions.map((ix) => ix.programId), message: tx.serializeMessage() };
}
