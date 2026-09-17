/*
 * The keeper loop: rolls the expiry grid on every market (16:00 New York Fridays plus whatever the operator adds),
 * records issuer pauses (`observe_halt`), settles every writer after expiry, closes series after grace, and inside the
 * pre-expiry window auto-exercises opted-in holders when the posted Pyth price says they are in the money. Every
 * crank is permissionless and destination-derived, so a stolen keeper key can only spend its own SOL.
 */
import type { PublicKey } from "@solana/web3.js";
import { ExtensionType, getAccount, getAssociatedTokenAddressSync, getExtensionData, getMint, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import type { RosterClient} from "@roster/sdk";
import { type MarketState, type SeriesState, autoExercisePda } from "@roster/sdk";
import { nextExpiries } from "@roster/core";

export interface KeeperLogLine {
  at: number;
  action: "roll_grid" | "observe_halt" | "settle" | "close" | "auto_exercise" | "skip";
  target: string;
  detail: string;
}

export interface KeeperConfig {
  /** Weekdays (0 = Sunday) whose 16:00 New York becomes an expiry; the operator adds a Tuesday for the submission tape. */
  expiryWeekdays: number[];
  expiriesAhead: number;
}

export const DEFAULT_KEEPER: KeeperConfig = { expiryWeekdays: [5], expiriesAhead: 2 };

/** The program's own error line when there is one, else the first line of the RPC message. */
function reason(e: unknown): string {
  const m = (e as Error).message ?? String(e);
  const anchor = m.match(/Error Code: (\w+)\. Error Number: (\d+)\. Error Message: ([^.]*)/);
  if (anchor) return `${anchor[1]} (${anchor[2]}): ${anchor[3]}`;
  const custom = m.match(/custom program error: (0x[0-9a-f]+)/);
  return (custom ? `custom program error ${custom[1]} ` : "") + m.split("\n")[0]!.slice(0, 120);
}

export class Keeper {
  readonly log: KeeperLogLine[] = [];
  constructor(private readonly client: RosterClient, private readonly treasury: PublicKey, private readonly cfg: KeeperConfig = DEFAULT_KEEPER) {}

  private say(line: KeeperLogLine): void {
    this.log.push(line);
    if (this.log.length > 2_000) this.log.shift();
    console.log(`[keeper] ${line.action} ${line.target.slice(0, 12)} ${line.detail}`);
  }

  /** Keep `allowedExpiries` holding the next expiries; the authority signs this (the keeper wallet is the authority on the fork only). */
  async rollGrid(m: MarketState, nowTs: number, extra: bigint[] = []): Promise<boolean> {
    const want = [...new Set([...extra, ...nextExpiries(nowTs, this.cfg.expiriesAhead, this.cfg.expiryWeekdays).map(BigInt)])].filter((e) => e > BigInt(nowTs)).sort((a, b) => (a < b ? -1 : 1)).slice(0, 4);
    const have = m.allowedExpiries.filter((e) => e > BigInt(nowTs));
    if (want.length === have.length && want.every((e, i) => e === have[i])) return false;
    try {
      await this.client.send(await this.client.updateMarket(m.mint, { allowedExpiries: want }));
      this.say({ at: nowTs, action: "roll_grid", target: m.mint.toBase58(), detail: want.map(String).join(",") });
      return true;
    } catch (e) {
      this.say({ at: nowTs, action: "skip", target: m.mint.toBase58(), detail: `roll_grid failed: ${(e as Error).message.slice(0, 120)}` });
      return false;
    }
  }

  /** Settle, close, and halt-watch every series of a market. Returns transactions sent. */
  /** Grace comes from the protocol account: the program decides when a series may close, the keeper only follows. */
  async cycle(m: MarketState, nowTs: number, mintPaused: boolean): Promise<number> {
    const graceSecs = (await this.client.fetchProtocol()).graceSecs;
    let sent = 0;
    const all = await this.client.fetchSeriesForMarket(m.address);
    for (const s of all) {
      if (mintPaused && !s.halted) {
        try {
          await this.client.send(await this.client.observeHalt(m, s));
          sent += 1;
          this.say({ at: nowTs, action: "observe_halt", target: s.address.toBase58(), detail: "issuer pause recorded" });
        } catch (e) {
          this.say({ at: nowTs, action: "skip", target: s.address.toBase58(), detail: `observe_halt failed: ${reason(e)}` });
        }
      }
      if (BigInt(nowTs) < s.expiryTs) continue;
      for (const w of s.writers) {
        if (w.settled) continue;
        try {
          await this.client.send(await this.client.settleWriter(m, s, w.writer));
          sent += 1;
          this.say({ at: nowTs, action: "settle", target: s.address.toBase58(), detail: `writer ${w.writer.toBase58().slice(0, 8)}` });
        } catch (e) {
          this.say({ at: nowTs, action: "skip", target: s.address.toBase58(), detail: `settle ${w.writer.toBase58().slice(0, 8)} failed: ${reason(e)}` });
        }
      }
      if (BigInt(nowTs) >= s.expiryTs + graceSecs) {
        const fresh = await this.client.fetchSeries(s.address);
        if (fresh && fresh.writers.every((w) => w.settled || (w.soldLots6 === 0n && w.depositedLots6 === w.withdrawnLots6 && w.premiumClaimable === 0n))) {
          try {
            await this.client.send(await this.client.closeSeries(m, fresh, this.treasury));
            sent += 1;
            this.say({ at: nowTs, action: "close", target: s.address.toBase58(), detail: "rent reclaimed" });
          } catch (e) {
            this.say({ at: nowTs, action: "skip", target: s.address.toBase58(), detail: `close failed: ${reason(e)}` });
          }
        }
      }
    }
    return sent;
  }

  /** Holders who opted in and still hold position tokens of a series in the auto-exercise window. */
  async candidates(m: MarketState, s: SeriesState, nowTs: number, graceSecs: number): Promise<{ holder: PublicKey; lots6: bigint }[]> {
    if (BigInt(nowTs) < s.expiryTs - BigInt(graceSecs) || BigInt(nowTs) >= s.expiryTs) return [];
    const conn = this.client.provider.connection;
    // The largest holders of the position mint (twenty per RPC call), filtered to those who opted in.
    const largest = await conn.getTokenLargestAccounts(s.positionMint, "confirmed");
    const out: { holder: PublicKey; lots6: bigint }[] = [];
    for (const l of largest.value) {
      if (!l.amount || l.amount === "0") continue;
      const acc = await getAccount(conn, l.address, "confirmed", TOKEN_2022_PROGRAM_ID);
      const optIn = await conn.getAccountInfo(autoExercisePda(this.client.programId, acc.owner, s.address));
      if (!optIn) continue;
      out.push({ holder: acc.owner, lots6: acc.amount });
    }
    void m;
    return out;
  }

  /** Whether the underlying mint is paused right now (Token-2022 PausableConfig). */
  async mintPaused(mint: PublicKey, tokenProgram: PublicKey): Promise<boolean> {
    if (!tokenProgram.equals(TOKEN_2022_PROGRAM_ID)) return false;
    try {
      const m = await getMint(this.client.provider.connection, mint, "confirmed", TOKEN_2022_PROGRAM_ID);
      // PausableConfig layout: authority (32 bytes) then the paused flag.
      const data = getExtensionData(ExtensionType.PausableConfig, m.tlvData);
      return !!data && data.length >= 33 && data[32] === 1;
    } catch {
      return false;
    }
  }
}

export { getAssociatedTokenAddressSync };
