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

describe("gridPlan: the cap never leaves the book dark at an expiry", async () => {
  const { gridPlan } = await import("./quoter");
  const H = 3600n;
  const now = 1_000_000n;
  const e1 = now + 20n * H; // tomorrow
  const e2 = now + 44n * H; // the day after
  const e3 = now + 7n * 24n * H;
  const sides = [{ side: "call" as const, strikes: [10n, 11n, 12n] }, { side: "put" as const, strikes: [9n, 8n, 7n] }];

  it("gives both of the next two expiries an Upside and a Floor before any second strike", () => {
    const first4 = gridPlan([e1, e2, e3], now, H, 1, sides).pairs.slice(0, 4).map((p) => `${p.side}@${p.expiry === e1 ? 1 : p.expiry === e2 ? 2 : 3}`);
    expect(first4).toEqual(["call@1", "put@1", "call@2", "put@2"]);
  });

  it("never creates a series for an expiry inside the grace period, but keeps quoting it", () => {
    const soon = now + H / 2n;
    const plan = gridPlan([soon, e1, e2], now, H, 1, sides);
    expect(plan.pairs.some((p) => p.expiry === soon)).toBe(false);
    expect(plan.quotable).toContain(soon);
  });

  it("quotes two creatable expiries on Tier 2, plus any about to expire", () => {
    expect(gridPlan([e1, e2, e3], now, H, 2, sides).quotable).toEqual([e1, e2]);
    expect(gridPlan([now + 10n, e1, e2, e3], now, H, 2, sides).quotable).toEqual([now + 10n, e1, e2]);
  });

  it("with a cap of eight covers two expiries with two strikes a side each", () => {
    const eight = gridPlan([e1, e2, e3], now, H, 1, sides).pairs.slice(0, 8);
    for (const e of [e1, e2]) for (const side of ["call", "put"]) expect(eight.filter((p) => p.expiry === e && p.side === side).length).toBe(2);
  });
});
