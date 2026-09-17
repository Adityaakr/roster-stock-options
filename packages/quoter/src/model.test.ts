import { describe, expect, it } from "vitest";
import { blackScholes, decideAsk, gridStrikes, normCdf } from "./model";

describe("black-scholes", () => {
  it("prices an ATM one-week call on a 180 lot near the textbook value", () => {
    // sigma 0.40, T = 7/365: ATM call ~ 0.4 * S * sqrt(T) / sqrt(2 pi) ~ 180 * 0.4 * 0.1385 * 0.3989 ~ 3.98
    const v = blackScholes("call", 180, 180, 7 / 365, 0.4);
    expect(v).toBeGreaterThan(3.7);
    expect(v).toBeLessThan(4.3);
    expect(normCdf(0)).toBeCloseTo(0.5, 6);
  });
  it("put-call parity holds with r = q = 0", () => {
    const c = blackScholes("call", 182.3, 180, 7 / 365, 0.45);
    const p = blackScholes("put", 182.3, 180, 7 / 365, 0.45);
    expect(c - p).toBeCloseTo(182.3 - 180, 6);
  });
});

describe("ask decision", () => {
  const base = { side: "call" as const, price: 182.3, multiplier: 1.001701196801074, pendingDividendMultiplier: null, strikeUsdcPerLot: 180_306_215n, expiryTs: 7 * 86_400, nowTs: 0, vol: 0.45, session: "regular" as const, inActivationWindow: false, inventoryLots: 0, baseSpread: 0.12, minAskPerLot: 50_000n };
  it("widens by session and by activation, never below the minimum", () => {
    const reg = decideAsk(base);
    const closed = decideAsk({ ...base, session: "closed" });
    const act = decideAsk({ ...base, session: "closed", inActivationWindow: true });
    expect(closed.askPerLot).toBeGreaterThan(reg.askPerLot);
    expect(act.askPerLot).toBeGreaterThan(closed.askPerLot);
    expect(decideAsk({ ...base, strikeUsdcPerLot: 900_000_000n }).askPerLot).toBe(50_000n);
  });
  it("uses the pending multiplier for the forward only when told it is a dividend", () => {
    const withDiv = decideAsk({ ...base, pendingDividendMultiplier: 1.1 });
    expect(withDiv.forwardPerLot).toBeCloseTo(182.3 * 1.1, 9);
    expect(decideAsk(base).forwardPerLot).toBeCloseTo(182.3 * base.multiplier, 9);
  });
  it("grid strikes sit on the step around the forward", () => {
    const ks = gridStrikes("call", 182.6, 1_000_000n);
    expect(ks).toEqual([183_000_000n, 188_000_000n, 192_000_000n]);
    const ps = gridStrikes("put", 182.6, 1_000_000n);
    expect(ps).toEqual([182_000_000n, 178_000_000n, 173_000_000n]);
  });
});
