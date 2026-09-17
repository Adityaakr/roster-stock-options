import { describe, expect, it } from "vitest";
import { SqliteStore } from "./store";
import { fillableAt } from "./indexer";
import { PublicKey } from "@solana/web3.js";
import type { SeriesState } from "@roster/sdk";

describe("sqlite store", () => {
  it("is idempotent on events and resumable by signature", () => {
    const s = new SqliteStore(":memory:");
    expect(s.insertEvent({ signature: "a", ix_index: 0, slot: 1, block_time: 1, name: "Fill", data_json: "{}" })).toBe(true);
    expect(s.insertEvent({ signature: "a", ix_index: 0, slot: 1, block_time: 1, name: "Fill", data_json: "{}" })).toBe(false);
    s.markSignature("a", 1);
    expect(s.hasSignature("a")).toBe(true);
    expect(s.hasSignature("b")).toBe(false);
    expect(s.events({ name: "Fill" }).length).toBe(1);
  });
});

describe("fillable sizes walk the book like buy", () => {
  const k = PublicKey.default;
  const series: SeriesState = { address: k, market: k, side: "call", strikeUsdcPerLot: 180_000_000n, expiryTs: 0n, collateralVault: k, settlementVault: k, quoteVault: k, positionMint: k, totalSoldLots6: 0n, totalExercisedLots6: 0n, unassignedLots6: 0n, epoch: 0, halted: false, rentPayer: k,
    asks: [{ remainingLots6: 20_000_000n, askPerLot: 5_400_000n, seq: 1n, writerSlot: 0 }, { remainingLots6: 40_000_000n, askPerLot: 5_600_000n, seq: 2n, writerSlot: 1 }], writers: [] };
  it("prices 10 lots from the best ask and 50 across two", () => {
    expect(fillableAt(series, 10_000_000n)).toEqual({ size_lots6: "10000000", avg_ask_per_lot: "5400000", cost_usdc: "54000000", asks_walked: 1 });
    const f = fillableAt(series, 50_000_000n);
    expect(f.asks_walked).toBe(2);
    expect(f.cost_usdc).toBe(((20n * 5_400_000n) + (30n * 5_600_000n)).toString());
  });
  it("reports null when the book cannot fill the size", () => {
    expect(fillableAt(series, 200_000_000n).cost_usdc).toBeNull();
  });
});
