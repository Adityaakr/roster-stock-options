/**
 * TypeScript client for roster_finance (Anchor 1.2.0, @anchor-lang/core). The IDL and its types are copied from
 * target/ by `pnpm idl:sync` after `anchor build`. Every method returns an unsigned Transaction built for
 * `signTransaction`-only wallets (CLAUDE.md 4.4); `send()` signs with the provider wallet and confirms by polling.
 */
import * as anchorNs from "@anchor-lang/core";
import type { Wallet as NodeWallet } from "@anchor-lang/core";
import type { Wallet } from "@anchor-lang/core/dist/cjs/provider";
import BN from "bn.js";

// @anchor-lang/core ships CJS and ESM; Node's CJS interop exposes the module as `default`, bundlers as the namespace.
const anchor = ((anchorNs as { default?: unknown }).default ?? anchorNs) as typeof anchorNs;
const { AnchorProvider, Program } = anchor;
import { ComputeBudgetProgram, PublicKey, SystemProgram, type Commitment, type Connection, type Transaction } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import idlJson from "./idl/roster_finance.json" with { type: "json" };
import type { RosterFinance } from "./idl/roster_finance";
import { autoExerciseAuthority, autoExercisePda, epochRecordPda, marketPda, protocolPda, seriesPda, vaultBidPda, vaultKindByte, vaultPda, vaultPdas, vaultPositionPda, vaultShareMint, type Side, type VaultKind } from "./pda";

export const ROSTER_IDL = idlJson as RosterFinance;

/**
 * A wallet that can build but never sign: what a server uses to assemble a transaction for a browser wallet to sign
 * (CLAUDE.md 4.4: the app builds every transaction and asks the wallet for `signTransaction` only).
 */
export function readOnlyWallet(publicKey: PublicKey): Wallet {
  const refuse = () => Promise.reject(new Error("read-only wallet: sign in the browser wallet"));
  return { publicKey, signTransaction: refuse, signAllTransactions: refuse };
}

export interface AutoExerciseState {
  address: PublicKey;
  enabled: boolean;
  minItmBps: number;
}
export const ROSTER_PROGRAM_ID = new PublicKey((idlJson as { address: string }).address);

export interface ProtocolState {
  address: PublicKey;
  authority: PublicKey;
  pauseAuthority: PublicKey;
  treasury: PublicKey;
  quoteMint: PublicKey;
  feeBps: number;
  integratorShareBps: number;
  keeperFeeUsdc: bigint;
  graceSecs: bigint;
  pausedAll: boolean;
  seriesCreator: PublicKey;
}

export interface MarketState {
  address: PublicKey;
  mint: PublicKey;
  quoteMint: PublicKey;
  tokenProgram: PublicKey;
  decimals: number;
  hasTransferFee: boolean;
  hasPermanentDelegate: boolean;
  pausable: boolean;
  hookProgram: PublicKey;
  tokenFeedId: Uint8Array;
  equityFeedId: Uint8Array;
  allowedExpiries: bigint[];
  strikeStep: bigint;
  minStrike: bigint;
  maxStrike: bigint;
  maxLiveSeries: number;
  liveSeries: number;
  minLots6: bigint;
  maxLots6: bigint;
  maxWriterLots6: bigint;
  tier: number;
  listed: boolean;
  paused: boolean;
  symbol: string;
  feedPricesUiShare: boolean;
}

export interface AskState {
  remainingLots6: bigint;
  askPerLot: bigint;
  seq: bigint;
  writerSlot: number;
}

export interface WriterState {
  writer: PublicKey;
  depositedLots6: bigint;
  withdrawnLots6: bigint;
  soldLots6: bigint;
  openLots6: bigint;
  assignedLots6: bigint;
  premiumClaimable: bigint;
  settled: boolean;
}

/** Part 3: a vault's on-chain state, decoded. Amounts in raw units of the collateral or other asset; shares carry six decimals. */
export interface VaultState {
  address: PublicKey;
  market: PublicKey;
  kind: VaultKind;
  halted: boolean;
  collateralMint: PublicKey;
  otherMint: PublicKey;
  manager: PublicKey;
  shareMint: PublicKey;
  collateralAta: PublicKey;
  otherAta: PublicKey;
  epoch: number;
  epochStartTs: bigint;
  nextRollTs: bigint;
  rollIntervalSecs: bigint;
  totalShares: bigint;
  lockedRaw: bigint;
  pendingDepositRaw: bigint;
  pendingWithdrawShares: bigint;
  reservedCollateralRaw: bigint;
  reservedOther: bigint;
  capPerSeriesLots6: bigint;
  capTotalLots6: bigint;
  spreadBps: number;
  lastMarkUsdcPerLot: bigint;
  markBandBps: number;
  epochPremiumIn: bigint;
  epochBuybackOut: bigint;
  epochAssignedLots6: bigint;
  navPerShare1e6: bigint;
  epochPnlPerShare1e6: bigint;
}

export interface EpochRecordState {
  address: PublicKey;
  vault: PublicKey;
  epoch: number;
  rolledAt: bigint;
  sharesPerRaw1e12: bigint;
  collateralPerShare1e12: bigint;
  otherPerShare1e12: bigint;
  navCollateralRaw: bigint;
  navOther: bigint;
  markUsdcPerLot: bigint;
  totalSharesAfter: bigint;
  premiumIn: bigint;
  buybackOut: bigint;
  assignedLots6: bigint;
  pnlPerShare1e6: bigint;
}

export interface VaultPositionState {
  address: PublicKey;
  owner: PublicKey;
  queuedDepositRaw: bigint;
  queuedDepositEpoch: number;
  queuedWithdrawShares: bigint;
  queuedWithdrawEpoch: number;
}

export interface VaultBidState {
  address: PublicKey;
  series: PublicKey;
  bidPerLot: bigint;
  maxLots6: bigint;
  postedAt: bigint;
  expiresAt: bigint;
}

export interface SeriesState {
  address: PublicKey;
  market: PublicKey;
  side: Side;
  strikeUsdcPerLot: bigint;
  expiryTs: bigint;
  collateralVault: PublicKey;
  settlementVault: PublicKey;
  quoteVault: PublicKey;
  positionMint: PublicKey;
  totalSoldLots6: bigint;
  totalExercisedLots6: bigint;
  unassignedLots6: bigint;
  epoch: number;
  halted: boolean;
  rentPayer: PublicKey;
  asks: AskState[];
  writers: WriterState[];
}

export interface CreateMarketInput {
  mint: PublicKey;
  tokenFeedId: Uint8Array;
  equityFeedId: Uint8Array;
  allowedExpiries: bigint[];
  strikeStep: bigint;
  minStrike: bigint;
  maxStrike: bigint;
  maxLiveSeries: number;
  minLots6: bigint;
  maxLots6: bigint;
  maxWriterLots6: bigint;
  tier: number;
  maxPriceAgeSecs: number;
  maxConfBps: number;
  symbol: string;
  feedPricesUiShare: boolean;
}

const bn = (v: bigint | number) => new BN(v.toString());
const big = (v: { toString(): string }) => BigInt(v.toString());
const sideArg = (side: Side) => (side === "call" ? { call: {} } : { put: {} });
const pad4 = (xs: bigint[]) => [...xs, 0n, 0n, 0n, 0n].slice(0, 4).map(bn);

export class RosterClient {
  readonly provider: InstanceType<typeof AnchorProvider>;
  readonly program: InstanceType<typeof Program<RosterFinance>>;
  readonly programId: PublicKey;
  priorityMicroLamports = 20_000;

  constructor(connection: Connection, wallet: Wallet | NodeWallet, programId: PublicKey = ROSTER_PROGRAM_ID) {
    this.provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
    this.program = new Program<RosterFinance>({ ...ROSTER_IDL, address: programId.toBase58() } as RosterFinance, this.provider);
    this.programId = programId;
  }

  get wallet(): PublicKey {
    return this.provider.wallet.publicKey;
  }
  get protocol(): PublicKey {
    return protocolPda(this.programId);
  }
  market(mint: PublicKey): PublicKey {
    return marketPda(this.programId, mint);
  }
  series(market: PublicKey, side: Side, strike: bigint, expiry: bigint): PublicKey {
    return seriesPda(this.programId, market, side, strike, expiry);
  }

  // ---------- reads ----------

  async fetchProtocol(): Promise<ProtocolState> {
    const p = await this.program.account.protocol.fetch(this.protocol);
    return { address: this.protocol, authority: p.authority, pauseAuthority: p.pauseAuthority, treasury: p.treasury, quoteMint: p.quoteMint, feeBps: p.feeBps, integratorShareBps: p.integratorShareBps, keeperFeeUsdc: big(p.keeperFeeUsdc), graceSecs: big(p.graceSecs), pausedAll: p.pausedAll, seriesCreator: p.seriesCreator };
  }

  async fetchMarket(mint: PublicKey): Promise<MarketState | null> {
    const address = this.market(mint);
    const m = await this.program.account.marketConfig.fetchNullable(address);
    if (!m) return null;
    return { address, mint: m.mint, quoteMint: m.quoteMint, tokenProgram: m.tokenProgram, decimals: m.decimals, hasTransferFee: m.hasTransferFee, hasPermanentDelegate: m.hasPermanentDelegate, pausable: m.pausable, hookProgram: m.hookProgram, tokenFeedId: Uint8Array.from(m.tokenFeedId), equityFeedId: Uint8Array.from(m.equityFeedId), allowedExpiries: m.allowedExpiries.map(big).filter((x: bigint) => x > 0n), strikeStep: big(m.strikeStep), minStrike: big(m.minStrike), maxStrike: big(m.maxStrike), maxLiveSeries: m.maxLiveSeries, liveSeries: m.liveSeries, minLots6: big(m.minLots6), maxLots6: big(m.maxLots6), maxWriterLots6: big(m.maxWriterLots6), tier: m.tier, listed: m.listed, paused: m.paused, symbol: Buffer.from(m.symbol).toString("utf8").replace(/\0+$/, ""), feedPricesUiShare: m.feedPricesUiShare };
  }

  private decodeSeries(address: PublicKey, s: Awaited<ReturnType<typeof this.program.account.series.fetch>>): SeriesState {
    return {
      address,
      market: s.market,
      side: s.side === 0 ? "call" : "put",
      strikeUsdcPerLot: big(s.strikeUsdcPerLot),
      expiryTs: big(s.expiryTs),
      collateralVault: s.collateralVault,
      settlementVault: s.settlementVault,
      quoteVault: s.quoteVault,
      positionMint: s.positionMint,
      totalSoldLots6: big(s.totalSoldLots6),
      totalExercisedLots6: big(s.totalExercisedLots6),
      unassignedLots6: big(s.unassignedLots6),
      epoch: s.epoch,
      halted: s.state === 1,
      rentPayer: s.rentPayer,
      asks: s.asks.slice(0, s.asksLen).map((a) => ({ remainingLots6: big(a.remainingLots6), askPerLot: big(a.askPerLot), seq: big(a.seq), writerSlot: a.writerSlot })),
      writers: s.writers.filter((w) => !w.writer.equals(PublicKey.default)).map((w) => ({ writer: w.writer, depositedLots6: big(w.depositedLots6), withdrawnLots6: big(w.withdrawnLots6), soldLots6: big(w.soldLots6), openLots6: big(w.openLots6), assignedLots6: big(w.assignedLots6), premiumClaimable: big(w.premiumClaimable), settled: w.settled !== 0 }))
    };
  }

  async fetchSeries(address: PublicKey): Promise<SeriesState | null> {
    const s = await this.program.account.series.fetchNullable(address);
    return s ? this.decodeSeries(address, s) : null;
  }

  /** Every series of a market (memcmp on the market key at offset 8, after the discriminator). */
  /*
   * Every series of a market. A program-wide scan is the obvious way and the wrong one: the RPC tiers most operators
   * run on refuse `getProgramAccounts` outright, and a scan grows with the whole protocol rather than with the market.
   * So a caller that knows the addresses (the indexer learns them from each SeriesCreated event) hands them over
   * through `seriesIndex`, and this reads exactly those accounts. The scan stays as the fallback for callers that
   * have no index, and a refused scan says so plainly.
   */
  seriesIndex: ((market: PublicKey) => Promise<PublicKey[]> | PublicKey[]) | null = null;

  async fetchSeriesForMarket(market: PublicKey): Promise<SeriesState[]> {
    if (this.seriesIndex) return this.fetchSeriesMany(await this.seriesIndex(market));
    try {
      const all = await this.program.account.series.all([{ memcmp: { offset: 8, bytes: market.toBase58() } }]);
      return all.map((x) => this.decodeSeries(x.publicKey, x.account));
    } catch (e) {
      const why = (e as Error).message ?? "";
      if (/getProgramAccounts/i.test(why)) throw new Error(`this RPC refuses getProgramAccounts (${why.split("\n")[0]}); give the client a seriesIndex or use an RPC that allows scans`);
      throw e;
    }
  }

  /** Read named series accounts in batches of a hundred; addresses that no longer exist are simply absent. */
  async fetchSeriesMany(addresses: PublicKey[]): Promise<SeriesState[]> {
    const out: SeriesState[] = [];
    for (let i = 0; i < addresses.length; i += 100) {
      const chunk = addresses.slice(i, i + 100);
      const infos = await this.provider.connection.getMultipleAccountsInfo(chunk, "confirmed");
      infos.forEach((info, j) => {
        if (!info) return;
        out.push(this.decodeSeries(chunk[j]!, this.program.coder.accounts.decode("series", info.data)));
      });
    }
    return out;
  }

  // ---------- builders (unsigned transactions) ----------

  async initProtocol(quoteMint: PublicKey, params: { pauseAuthority: PublicKey; treasury: PublicKey; feeBps: number; integratorShareBps: number; keeperFeeUsdc: bigint; graceSecs: bigint }): Promise<Transaction> {
    return this.program.methods
      .initProtocol({ pauseAuthority: params.pauseAuthority, treasury: params.treasury, feeBps: params.feeBps, integratorShareBps: params.integratorShareBps, keeperFeeUsdc: bn(params.keeperFeeUsdc), graceSecs: bn(params.graceSecs) })
      .accountsPartial({ authority: this.wallet, protocol: this.protocol, quoteMint, feeVault: getAssociatedTokenAddressSync(quoteMint, this.protocol, true, TOKEN_PROGRAM_ID), quoteTokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
      .transaction();
  }

  async updateProtocol(params: Partial<{ authority: PublicKey; pauseAuthority: PublicKey; treasury: PublicKey; feeBps: number; integratorShareBps: number; keeperFeeUsdc: bigint; graceSecs: bigint; pausedAll: boolean; seriesCreator: PublicKey }>): Promise<Transaction> {
    const p = params;
    return this.program.methods
      .updateProtocol({ authority: p.authority ?? null, pauseAuthority: p.pauseAuthority ?? null, treasury: p.treasury ?? null, feeBps: p.feeBps ?? null, integratorShareBps: p.integratorShareBps ?? null, keeperFeeUsdc: p.keeperFeeUsdc !== undefined ? bn(p.keeperFeeUsdc) : null, graceSecs: p.graceSecs !== undefined ? bn(p.graceSecs) : null, pausedAll: p.pausedAll ?? null, seriesCreator: p.seriesCreator ?? null })
      .accountsPartial({ signer: this.wallet, protocol: this.protocol })
      .transaction();
  }

  async createMarket(input: CreateMarketInput): Promise<Transaction> {
    return this.program.methods
      .createMarket({ tokenFeedId: Array.from(input.tokenFeedId), equityFeedId: Array.from(input.equityFeedId), allowedExpiries: pad4(input.allowedExpiries), strikeStep: bn(input.strikeStep), minStrike: bn(input.minStrike), maxStrike: bn(input.maxStrike), maxLiveSeries: input.maxLiveSeries, minLots6: bn(input.minLots6), maxLots6: bn(input.maxLots6), maxWriterLots6: bn(input.maxWriterLots6), tier: input.tier, maxPriceAgeSecs: input.maxPriceAgeSecs, maxConfBps: input.maxConfBps, symbol: Array.from(Buffer.from(input.symbol.padEnd(8, "\0").slice(0, 8))), feedPricesUiShare: input.feedPricesUiShare })
      .accountsPartial({ authority: this.wallet, protocol: this.protocol, market: this.market(input.mint), mint: input.mint, systemProgram: SystemProgram.programId })
      .transaction();
  }

  async updateMarket(mint: PublicKey, params: Partial<{ allowedExpiries: bigint[]; strikeStep: bigint; minStrike: bigint; maxStrike: bigint; maxLiveSeries: number; minLots6: bigint; maxLots6: bigint; maxWriterLots6: bigint; tier: number; listed: boolean; paused: boolean; maxPriceAgeSecs: number; maxConfBps: number }>): Promise<Transaction> {
    const p = params;
    return this.program.methods
      .updateMarket({ allowedExpiries: p.allowedExpiries ? pad4(p.allowedExpiries) : null, strikeStep: p.strikeStep !== undefined ? bn(p.strikeStep) : null, minStrike: p.minStrike !== undefined ? bn(p.minStrike) : null, maxStrike: p.maxStrike !== undefined ? bn(p.maxStrike) : null, maxLiveSeries: p.maxLiveSeries ?? null, minLots6: p.minLots6 !== undefined ? bn(p.minLots6) : null, maxLots6: p.maxLots6 !== undefined ? bn(p.maxLots6) : null, maxWriterLots6: p.maxWriterLots6 !== undefined ? bn(p.maxWriterLots6) : null, tier: p.tier ?? null, listed: p.listed ?? null, paused: p.paused ?? null, maxPriceAgeSecs: p.maxPriceAgeSecs ?? null, maxConfBps: p.maxConfBps ?? null })
      .accountsPartial({ signer: this.wallet, protocol: this.protocol, market: this.market(mint) })
      .transaction();
  }

  private legs(m: MarketState, side: Side) {
    const underlyingProgram = m.tokenProgram;
    return side === "call"
      ? { collateralMint: m.mint, settlementMint: m.quoteMint, collateralProgram: underlyingProgram, settlementProgram: TOKEN_PROGRAM_ID }
      : { collateralMint: m.quoteMint, settlementMint: m.mint, collateralProgram: TOKEN_PROGRAM_ID, settlementProgram: underlyingProgram };
  }

  async createSeries(m: MarketState, side: Side, strikeUsdcPerLot: bigint, expiryTs: bigint): Promise<{ tx: Transaction; series: PublicKey }> {
    const series = this.series(m.address, side, strikeUsdcPerLot, expiryTs);
    const v = vaultPdas(this.programId, series);
    const l = this.legs(m, side);
    const tx = await this.program.methods
      .createSeries(sideArg(side), bn(strikeUsdcPerLot), bn(expiryTs))
      .accountsPartial({ payer: this.wallet, protocol: this.protocol, market: m.address, underlyingMint: m.mint, quoteMint: m.quoteMint, collateralMint: l.collateralMint, settlementMint: l.settlementMint, series, positionMint: v.positionMint, collateralVault: v.collateral, settlementVault: v.settlement, quoteVault: v.quote, collateralTokenProgram: l.collateralProgram, settlementTokenProgram: l.settlementProgram, quoteTokenProgram: TOKEN_PROGRAM_ID, token2022Program: TOKEN_2022_PROGRAM_ID, systemProgram: SystemProgram.programId })
      .transaction();
    return { tx, series };
  }

  private writerCollateralAccounts(m: MarketState, s: SeriesState, writer: PublicKey) {
    const l = this.legs(m, s.side);
    return { writer, protocol: this.protocol, market: m.address, series: s.address, collateralMint: l.collateralMint, collateralVault: s.collateralVault, writerCollateralAta: getAssociatedTokenAddressSync(l.collateralMint, writer, false, l.collateralProgram), collateralTokenProgram: l.collateralProgram };
  }

  async quote(m: MarketState, s: SeriesState, depositLots6: bigint, askLots6: bigint, askPerLot: bigint): Promise<Transaction> {
    return this.program.methods.quote(bn(depositLots6), bn(askLots6), bn(askPerLot)).accountsPartial(this.writerCollateralAccounts(m, s, this.wallet)).transaction();
  }
  async withdrawUnsold(m: MarketState, s: SeriesState, lots6: bigint): Promise<Transaction> {
    return this.program.methods.withdrawUnsold(bn(lots6)).accountsPartial(this.writerCollateralAccounts(m, s, this.wallet)).transaction();
  }
  async cancelAsk(s: SeriesState, seq: bigint): Promise<Transaction> {
    return this.program.methods.cancelAsk(bn(seq)).accountsPartial({ writer: this.wallet, series: s.address }).transaction();
  }
  async claimPremium(m: MarketState, s: SeriesState): Promise<Transaction> {
    return this.program.methods.claimPremium().accountsPartial({ writer: this.wallet, market: m.address, series: s.address, quoteMint: m.quoteMint, quoteVault: s.quoteVault, writerQuoteAta: getAssociatedTokenAddressSync(m.quoteMint, this.wallet, false, TOKEN_PROGRAM_ID), quoteTokenProgram: TOKEN_PROGRAM_ID }).transaction();
  }

  async buy(m: MarketState, s: SeriesState, lots6: bigint, maxPremiumPerLot: bigint, referrer: PublicKey | null = null): Promise<Transaction> {
    return this.program.methods
      .buy(bn(lots6), bn(maxPremiumPerLot), referrer)
      .accountsPartial({ buyer: this.wallet, protocol: this.protocol, market: m.address, series: s.address, quoteMint: m.quoteMint, quoteVault: s.quoteVault, feeVault: getAssociatedTokenAddressSync(m.quoteMint, this.protocol, true, TOKEN_PROGRAM_ID), buyerQuoteAta: getAssociatedTokenAddressSync(m.quoteMint, this.wallet, false, TOKEN_PROGRAM_ID), positionMint: s.positionMint, buyerPositionAta: getAssociatedTokenAddressSync(s.positionMint, this.wallet, false, TOKEN_2022_PROGRAM_ID), quoteTokenProgram: TOKEN_PROGRAM_ID, token2022Program: TOKEN_2022_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
      .transaction();
  }

  async exercise(m: MarketState, s: SeriesState, lots6: bigint): Promise<Transaction> {
    return this.program.methods
      .exercise(bn(lots6))
      .accountsPartial({ holder: this.wallet, market: m.address, series: s.address, underlyingMint: m.mint, quoteMint: m.quoteMint, positionMint: s.positionMint, holderPositionAta: getAssociatedTokenAddressSync(s.positionMint, this.wallet, false, TOKEN_2022_PROGRAM_ID), collateralVault: s.collateralVault, settlementVault: s.settlementVault, holderUnderlyingAta: getAssociatedTokenAddressSync(m.mint, this.wallet, false, m.tokenProgram), holderQuoteAta: getAssociatedTokenAddressSync(m.quoteMint, this.wallet, false, TOKEN_PROGRAM_ID), underlyingTokenProgram: m.tokenProgram, quoteTokenProgram: TOKEN_PROGRAM_ID, token2022Program: TOKEN_2022_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
      .transaction();
  }

  async settleWriter(m: MarketState, s: SeriesState, writer: PublicKey): Promise<Transaction> {
    return this.program.methods
      .settleWriter()
      .accountsPartial({ cranker: this.wallet, market: m.address, series: s.address, writer, underlyingMint: m.mint, quoteMint: m.quoteMint, collateralVault: s.collateralVault, settlementVault: s.settlementVault, quoteVault: s.quoteVault, writerUnderlyingAta: getAssociatedTokenAddressSync(m.mint, writer, false, m.tokenProgram), writerQuoteAta: getAssociatedTokenAddressSync(m.quoteMint, writer, false, TOKEN_PROGRAM_ID), underlyingTokenProgram: m.tokenProgram, quoteTokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
      .transaction();
  }

  async closeSeries(m: MarketState, s: SeriesState, treasury: PublicKey): Promise<Transaction> {
    return this.program.methods
      .closeSeries()
      .accountsPartial({ cranker: this.wallet, protocol: this.protocol, market: m.address, series: s.address, rentReceiver: s.rentPayer, underlyingMint: m.mint, quoteMint: m.quoteMint, positionMint: s.positionMint, collateralVault: s.collateralVault, settlementVault: s.settlementVault, quoteVault: s.quoteVault, feeVault: getAssociatedTokenAddressSync(m.quoteMint, this.protocol, true, TOKEN_PROGRAM_ID), treasury, treasuryUnderlyingAta: getAssociatedTokenAddressSync(m.mint, treasury, true, m.tokenProgram), underlyingTokenProgram: m.tokenProgram, quoteTokenProgram: TOKEN_PROGRAM_ID, token2022Program: TOKEN_2022_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
      .transaction();
  }

  async observeHalt(m: MarketState, s: SeriesState): Promise<Transaction> {
    return this.program.methods.observeHalt().accountsPartial({ market: m.address, series: s.address, underlyingMint: m.mint, collateralVault: s.collateralVault, settlementVault: s.settlementVault }).transaction();
  }

  async enableAutoExercise(m: MarketState, s: SeriesState, minItmBps: number): Promise<Transaction> {
    return this.program.methods.enableAutoExercise(minItmBps).accountsPartial(this.autoExerciseAccounts(m, s)).transaction();
  }

  private autoExerciseAccounts(m: MarketState, s: SeriesState) {
    const payMint = s.side === "call" ? m.quoteMint : m.mint;
    const payProgram = s.side === "call" ? TOKEN_PROGRAM_ID : m.tokenProgram;
    return { holder: this.wallet, market: m.address, series: s.address, autoExercise: autoExercisePda(this.programId, this.wallet, s.address), delegate: autoExerciseAuthority(this.programId), positionMint: s.positionMint, holderPositionAta: getAssociatedTokenAddressSync(s.positionMint, this.wallet, false, TOKEN_2022_PROGRAM_ID), payMint, holderPayAta: getAssociatedTokenAddressSync(payMint, this.wallet, false, payProgram), payTokenProgram: payProgram, token2022Program: TOKEN_2022_PROGRAM_ID, systemProgram: SystemProgram.programId };
  }

  /** Revokes the delegate on both accounts and marks the opt-in disabled. */
  async disableAutoExercise(m: MarketState, s: SeriesState): Promise<Transaction> {
    return this.program.methods.disableAutoExercise().accountsPartial(this.autoExerciseAccounts(m, s)).transaction();
  }

  async fetchAutoExercise(holder: PublicKey, series: PublicKey): Promise<AutoExerciseState | null> {
    const address = autoExercisePda(this.programId, holder, series);
    const a = await this.program.account.autoExercise.fetchNullable(address);
    return a ? { address, enabled: a.enabled, minItmBps: a.minItmBps } : null;
  }

  async withdrawFees(quoteMint: PublicKey, treasury: PublicKey, amount: bigint): Promise<Transaction> {
    return this.program.methods
      .withdrawFees(bn(amount))
      .accountsPartial({ authority: this.wallet, protocol: this.protocol, quoteMint, feeVault: getAssociatedTokenAddressSync(quoteMint, this.protocol, true, TOKEN_PROGRAM_ID), treasury, treasuryQuoteAta: getAssociatedTokenAddressSync(quoteMint, treasury, true, TOKEN_PROGRAM_ID), quoteTokenProgram: TOKEN_PROGRAM_ID })
      .transaction();
  }

  /** Priority fee, recent blockhash and fee payer, so a browser wallet can sign the transaction as-is. */
  async prepare(tx: Transaction): Promise<{ tx: Transaction; lastValidBlockHeight: number }> {
    const commitment: Commitment = this.provider.opts.commitment ?? "confirmed";
    tx.instructions.unshift(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: this.priorityMicroLamports }));
    const latest = await this.provider.connection.getLatestBlockhash(commitment);
    tx.recentBlockhash = latest.blockhash;
    tx.feePayer = this.wallet;
    return { tx, lastValidBlockHeight: latest.lastValidBlockHeight };
  }

  /**
   * Sign with the provider wallet, send, confirm by polling. Anchor's `.rpc()` gives up after 30 s; this waits until the
   * blockhash expires and re-sends the same signature meanwhile.
   */
  // ---------- Part 3: the vaults ----------

  vault(market: PublicKey, kind: VaultKind): PublicKey {
    return vaultPda(this.programId, market, kind);
  }

  /** A vault's own token accounts: collateral, the other asset, and the share escrow, all associated to the PDA. */
  vaultAccounts(m: MarketState, kind: VaultKind) {
    const vault = this.vault(m.address, kind);
    const shareMint = vaultShareMint(this.programId, vault);
    const cc = kind === "covered_call";
    const collateralMint = cc ? m.mint : m.quoteMint;
    const otherMint = cc ? m.quoteMint : m.mint;
    const collateralProgram = cc ? m.tokenProgram : TOKEN_PROGRAM_ID;
    const otherProgram = cc ? TOKEN_PROGRAM_ID : m.tokenProgram;
    return {
      vault, shareMint, collateralMint, otherMint, collateralProgram, otherProgram,
      collateralAta: getAssociatedTokenAddressSync(collateralMint, vault, true, collateralProgram),
      otherAta: getAssociatedTokenAddressSync(otherMint, vault, true, otherProgram),
      shareEscrow: getAssociatedTokenAddressSync(shareMint, vault, true, TOKEN_2022_PROGRAM_ID),
      underlyingAta: getAssociatedTokenAddressSync(m.mint, vault, true, m.tokenProgram),
      quoteAta: getAssociatedTokenAddressSync(m.quoteMint, vault, true, TOKEN_PROGRAM_ID),
    };
  }

  async fetchVault(m: MarketState, kind: VaultKind): Promise<VaultState | null> {
    const address = this.vault(m.address, kind);
    const v = await this.program.account.vault.fetchNullable(address);
    if (!v) return null;
    return {
      address, market: v.market, kind: v.kind === 0 ? "covered_call" : "cash_secured_put", halted: v.state === 2, collateralMint: v.collateralMint, otherMint: v.otherMint,
      manager: v.manager, shareMint: v.shareMint, collateralAta: v.collateralAta, otherAta: v.otherAta, epoch: v.epoch, epochStartTs: big(v.epochStartTs), nextRollTs: big(v.nextRollTs),
      rollIntervalSecs: big(v.rollIntervalSecs), totalShares: big(v.totalShares), lockedRaw: big(v.lockedRaw), pendingDepositRaw: big(v.pendingDepositRaw), pendingWithdrawShares: big(v.pendingWithdrawShares),
      reservedCollateralRaw: big(v.reservedCollateralRaw), reservedOther: big(v.reservedOther), capPerSeriesLots6: big(v.capPerSeriesLots6), capTotalLots6: big(v.capTotalLots6), spreadBps: v.spreadBps,
      lastMarkUsdcPerLot: big(v.lastMarkUsdcPerLot), markBandBps: v.markBandBps, epochPremiumIn: big(v.epochPremiumIn), epochBuybackOut: big(v.epochBuybackOut), epochAssignedLots6: big(v.epochAssignedLots6),
      navPerShare1e6: big(v.navPerShare1e6), epochPnlPerShare1e6: big(v.epochPnlPerShare1e6),
    };
  }

  async fetchEpochRecords(vault: PublicKey, epochs: number[]): Promise<EpochRecordState[]> {
    const addresses = epochs.map((e) => epochRecordPda(this.programId, vault, e));
    const rows = await this.program.account.epochRecord.fetchMultiple(addresses);
    const out: EpochRecordState[] = [];
    rows.forEach((r, i) => {
      if (!r) return;
      out.push({ address: addresses[i]!, vault: r.vault, epoch: r.epoch, rolledAt: big(r.rolledAt), sharesPerRaw1e12: big(r.sharesPerRaw1e12), collateralPerShare1e12: big(r.collateralPerShare1e12), otherPerShare1e12: big(r.otherPerShare1e12), navCollateralRaw: big(r.navCollateralRaw), navOther: big(r.navOther), markUsdcPerLot: big(r.markUsdcPerLot), totalSharesAfter: big(r.totalSharesAfter), premiumIn: big(r.premiumIn), buybackOut: big(r.buybackOut), assignedLots6: big(r.assignedLots6), pnlPerShare1e6: big(r.pnlPerShare1e6) });
    });
    return out;
  }

  async fetchVaultPosition(vault: PublicKey, owner: PublicKey): Promise<VaultPositionState | null> {
    const address = vaultPositionPda(this.programId, vault, owner);
    const p = await this.program.account.vaultPosition.fetchNullable(address);
    if (!p) return null;
    return { address, owner: p.owner, queuedDepositRaw: big(p.queuedDepositRaw), queuedDepositEpoch: p.queuedDepositEpoch, queuedWithdrawShares: big(p.queuedWithdrawShares), queuedWithdrawEpoch: p.queuedWithdrawEpoch };
  }

  async fetchVaultBid(vault: PublicKey, series: PublicKey): Promise<VaultBidState | null> {
    const address = vaultBidPda(this.programId, vault, series);
    const b = await this.program.account.vaultBid.fetchNullable(address);
    if (!b) return null;
    return { address, series: b.series, bidPerLot: big(b.bidPerLot), maxLots6: big(b.maxLots6), postedAt: big(b.postedAt), expiresAt: big(b.expiresAt) };
  }

  async initVault(m: MarketState, kind: VaultKind, params: { manager: PublicKey; rollIntervalSecs: bigint; firstRollTs: bigint; capPerSeriesLots6: bigint; capTotalLots6: bigint; spreadBps: number; markBandBps: number }): Promise<Transaction> {
    const a = this.vaultAccounts(m, kind);
    return this.program.methods
      .initVault({ kind: vaultKindByte(kind), manager: params.manager, rollIntervalSecs: bn(params.rollIntervalSecs), firstRollTs: bn(params.firstRollTs), capPerSeriesLots6: bn(params.capPerSeriesLots6), capTotalLots6: bn(params.capTotalLots6), spreadBps: params.spreadBps, markBandBps: params.markBandBps })
      .accountsPartial({ authority: this.wallet, protocol: this.protocol, market: m.address, vault: a.vault, collateralMint: a.collateralMint, otherMint: a.otherMint, shareMint: a.shareMint, collateralAta: a.collateralAta, otherAta: a.otherAta, shareEscrow: a.shareEscrow, collateralTokenProgram: a.collateralProgram, otherTokenProgram: a.otherProgram, token2022Program: TOKEN_2022_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
      .transaction();
  }

  async setVaultParams(m: MarketState, kind: VaultKind, u: { manager?: PublicKey; capPerSeriesLots6?: bigint; capTotalLots6?: bigint; spreadBps?: number; markBandBps?: number; rollIntervalSecs?: bigint; nextRollTs?: bigint }): Promise<Transaction> {
    return this.program.methods
      .setVaultParams({ manager: u.manager ?? null, capPerSeriesLots6: u.capPerSeriesLots6 === undefined ? null : bn(u.capPerSeriesLots6), capTotalLots6: u.capTotalLots6 === undefined ? null : bn(u.capTotalLots6), spreadBps: u.spreadBps ?? null, markBandBps: u.markBandBps ?? null, rollIntervalSecs: u.rollIntervalSecs === undefined ? null : bn(u.rollIntervalSecs), nextRollTs: u.nextRollTs === undefined ? null : bn(u.nextRollTs) })
      .accountsPartial({ authority: this.wallet, protocol: this.protocol, vault: this.vault(m.address, kind) })
      .transaction();
  }

  async vaultDeposit(m: MarketState, kind: VaultKind, raw: bigint): Promise<Transaction> {
    const a = this.vaultAccounts(m, kind);
    return this.program.methods
      .vaultDeposit(bn(raw))
      .accountsPartial({ owner: this.wallet, vault: a.vault, position: vaultPositionPda(this.programId, a.vault, this.wallet), collateralMint: a.collateralMint, collateralAta: a.collateralAta, ownerCollateralAta: getAssociatedTokenAddressSync(a.collateralMint, this.wallet, false, a.collateralProgram), collateralTokenProgram: a.collateralProgram, systemProgram: SystemProgram.programId })
      .transaction();
  }

  async vaultRequestWithdraw(m: MarketState, kind: VaultKind, shares: bigint): Promise<Transaction> {
    const a = this.vaultAccounts(m, kind);
    return this.program.methods
      .vaultRequestWithdraw(bn(shares))
      .accountsPartial({ owner: this.wallet, vault: a.vault, position: vaultPositionPda(this.programId, a.vault, this.wallet), shareMint: a.shareMint, ownerShareAta: getAssociatedTokenAddressSync(a.shareMint, this.wallet, false, TOKEN_2022_PROGRAM_ID), shareEscrow: a.shareEscrow, token2022Program: TOKEN_2022_PROGRAM_ID, systemProgram: SystemProgram.programId })
      .transaction();
  }

  async vaultClaim(m: MarketState, kind: VaultKind, epoch: number): Promise<Transaction> {
    const a = this.vaultAccounts(m, kind);
    return this.program.methods
      .vaultClaim(epoch)
      .accountsPartial({ owner: this.wallet, vault: a.vault, position: vaultPositionPda(this.programId, a.vault, this.wallet), record: epochRecordPda(this.programId, a.vault, epoch), shareMint: a.shareMint, collateralMint: a.collateralMint, otherMint: a.otherMint, collateralAta: a.collateralAta, otherAta: a.otherAta, shareEscrow: a.shareEscrow, ownerShareAta: getAssociatedTokenAddressSync(a.shareMint, this.wallet, false, TOKEN_2022_PROGRAM_ID), ownerCollateralAta: getAssociatedTokenAddressSync(a.collateralMint, this.wallet, false, a.collateralProgram), ownerOtherAta: getAssociatedTokenAddressSync(a.otherMint, this.wallet, false, a.otherProgram), collateralTokenProgram: a.collateralProgram, otherTokenProgram: a.otherProgram, token2022Program: TOKEN_2022_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
      .transaction();
  }

  async vaultRoll(m: MarketState, v: VaultState, markUsdcPerLot: bigint): Promise<Transaction> {
    const a = this.vaultAccounts(m, v.kind);
    return this.program.methods
      .vaultRoll(bn(markUsdcPerLot))
      .accountsPartial({ cranker: this.wallet, market: m.address, vault: a.vault, record: epochRecordPda(this.programId, a.vault, v.epoch), shareMint: a.shareMint, collateralAta: a.collateralAta, otherAta: a.otherAta, shareEscrow: a.shareEscrow, token2022Program: TOKEN_2022_PROGRAM_ID, systemProgram: SystemProgram.programId })
      .transaction();
  }

  private vaultWriteAccounts(m: MarketState, kind: VaultKind, s: SeriesState) {
    const a = this.vaultAccounts(m, kind);
    return { manager: this.wallet, protocol: this.protocol, market: m.address, vault: a.vault, series: s.address, collateralMint: a.collateralMint, collateralVault: s.collateralVault, collateralAta: a.collateralAta, collateralTokenProgram: a.collateralProgram };
  }

  async vaultQuote(m: MarketState, kind: VaultKind, s: SeriesState, depositLots6: bigint, askLots6: bigint, askPerLot: bigint): Promise<Transaction> {
    return this.program.methods.vaultQuote(bn(depositLots6), bn(askLots6), bn(askPerLot)).accountsPartial(this.vaultWriteAccounts(m, kind, s)).transaction();
  }

  async vaultWithdrawUnsold(m: MarketState, kind: VaultKind, s: SeriesState, lots6: bigint): Promise<Transaction> {
    return this.program.methods.vaultWithdrawUnsold(bn(lots6)).accountsPartial(this.vaultWriteAccounts(m, kind, s)).transaction();
  }

  async vaultCancelAsk(m: MarketState, kind: VaultKind, s: SeriesState, seq: bigint): Promise<Transaction> {
    return this.program.methods.vaultCancelAsk(bn(seq)).accountsPartial({ manager: this.wallet, vault: this.vault(m.address, kind), market: m.address, series: s.address }).transaction();
  }

  async vaultSettle(m: MarketState, kind: VaultKind, s: SeriesState): Promise<Transaction> {
    const a = this.vaultAccounts(m, kind);
    return this.program.methods
      .vaultSettle()
      .accountsPartial({ cranker: this.wallet, market: m.address, vault: a.vault, series: s.address, underlyingMint: m.mint, quoteMint: m.quoteMint, collateralVault: s.collateralVault, settlementVault: s.settlementVault, quoteVault: s.quoteVault, vaultUnderlyingAta: a.underlyingAta, vaultQuoteAta: a.quoteAta, underlyingTokenProgram: m.tokenProgram, quoteTokenProgram: TOKEN_PROGRAM_ID })
      .transaction();
  }

  async vaultPostBid(m: MarketState, kind: VaultKind, s: SeriesState, bidPerLot: bigint, maxLots6: bigint, ttlSecs: bigint): Promise<Transaction> {
    const vault = this.vault(m.address, kind);
    return this.program.methods
      .vaultPostBid(bn(bidPerLot), bn(maxLots6), bn(ttlSecs))
      .accountsPartial({ manager: this.wallet, vault, market: m.address, series: s.address, bid: vaultBidPda(this.programId, vault, s.address), systemProgram: SystemProgram.programId })
      .transaction();
  }

  async sellToVault(m: MarketState, kind: VaultKind, s: SeriesState, lots6: bigint, minBidPerLot: bigint): Promise<Transaction> {
    const a = this.vaultAccounts(m, kind);
    return this.program.methods
      .sellToVault(bn(lots6), bn(minBidPerLot))
      .accountsPartial({ holder: this.wallet, market: m.address, vault: a.vault, series: s.address, bid: vaultBidPda(this.programId, a.vault, s.address), positionMint: s.positionMint, holderPositionAta: getAssociatedTokenAddressSync(s.positionMint, this.wallet, false, TOKEN_2022_PROGRAM_ID), quoteMint: m.quoteMint, vaultQuoteAta: a.quoteAta, holderQuoteAta: getAssociatedTokenAddressSync(m.quoteMint, this.wallet, false, TOKEN_PROGRAM_ID), quoteTokenProgram: TOKEN_PROGRAM_ID, token2022Program: TOKEN_2022_PROGRAM_ID })
      .transaction();
  }

  async vaultSetHalt(m: MarketState, kind: VaultKind, halted: boolean, reason: number): Promise<Transaction> {
    return this.program.methods.vaultSetHalt(halted, reason).accountsPartial({ signer: this.wallet, protocol: this.protocol, vault: this.vault(m.address, kind) }).transaction();
  }

  async send(tx: Transaction): Promise<string> {
    const { tx: prepared, lastValidBlockHeight } = await this.prepare(tx);
    const signed = await this.provider.wallet.signTransaction(prepared);
    return sendRawAndConfirm(this.provider.connection, signed.serialize(), lastValidBlockHeight, this.provider.opts.commitment ?? "confirmed");
  }
}

/** Send a signed transaction and poll until it is confirmed, the blockhash expires, or it fails. */
export async function sendRawAndConfirm(connection: Connection, raw: Buffer | Uint8Array, lastValidBlockHeight: number, commitment: Commitment = "confirmed", deadlineMs = 180_000): Promise<string> {
  const signature = await connection.sendRawTransaction(raw, { skipPreflight: false, preflightCommitment: commitment, maxRetries: 0 });
  const wanted = commitment === "finalized" ? ["finalized"] : ["confirmed", "finalized"];
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let lastResend = Date.now();
  const started = Date.now();
  for (;;) {
    if (Date.now() - started > deadlineMs) throw new Error(`transaction ${signature} not confirmed within ${Math.round(deadlineMs / 1000)} s`);
    const st = (await connection.getSignatureStatuses([signature])).value[0];
    if (st) {
      if (st.err) throw new Error(`transaction ${signature} failed: ${JSON.stringify(st.err)}`);
      if (st.confirmationStatus && wanted.includes(st.confirmationStatus)) return signature;
    } else if (Date.now() - lastResend > 3000) {
      await connection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }).catch(() => undefined);
      lastResend = Date.now();
    }
    const height = await connection.getBlockHeight(commitment);
    if (height > lastValidBlockHeight && !st) throw new Error(`transaction ${signature} expired: block height exceeded before it was seen`);
    await sleep(400);
  }
}
