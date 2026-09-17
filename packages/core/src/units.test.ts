import { describe, expect, it } from "vitest";
import { lots6ToRaw, rawToLots6, strikePerShare, strikeUsdcPerLotFromDisplay, usdcOwedCeil, usdcPaidFloor } from "./units";
import { effectiveMultiplier } from "./multiplier";
import { sessionAt } from "./session";

describe("lots", () => {
  it("NVDAx (8 dp): half a lot is 50,000,000 raw, exactly", () => {
    expect(lots6ToRaw(500_000n, 8)).toBe(50_000_000n);
    expect(rawToLots6(50_000_000n, 8)).toBe(500_000n);
  });
  it("rejects mints under six decimals", () => {
    expect(() => lots6ToRaw(1n, 5)).toThrow();
  });
  it("strike 180 at the live NVDAx multiplier truncates to 180,306,215 and displays as 180.00", () => {
    const m = 1.001701196801074;
    const s = strikeUsdcPerLotFromDisplay(180, m);
    expect(s).toBe(180_306_215n);
    expect(strikePerShare(s, m)).toBeCloseTo(180, 5);
  });
  it("only the USDC leg rounds: owed rounds up, paid rounds down", () => {
    expect(usdcOwedCeil(500_000n, 180_306_215n)).toBe(90_153_108n);
    expect(usdcPaidFloor(500_000n, 180_306_215n)).toBe(90_153_107n);
  });
});

describe("multiplier", () => {
  it("uses new_multiplier once the activation timestamp has passed", () => {
    const cfg = { multiplier: 1.0009180758490996, newMultiplier: 1.001701196801074, newMultiplierEffectiveTimestamp: 1789000200n };
    expect(effectiveMultiplier(cfg, 1789000199)).toBe(1.0009180758490996);
    expect(effectiveMultiplier(cfg, 1789000200)).toBe(1.001701196801074);
  });
});

describe("session", () => {
  // 2026-09-19 is a Saturday. 15:00 UTC on it is 11:00 New York.
  it("a Saturday is closed", () => expect(sessionAt(Date.UTC(2026, 8, 19, 15) / 1000)).toBe("closed"));
  it("a weekday at 10:00 New York is regular", () => expect(sessionAt(Date.UTC(2026, 8, 18, 14) / 1000)).toBe("regular"));
  it("a Thursday at 21:00 New York is overnight", () => expect(sessionAt(Date.UTC(2026, 8, 18, 1) / 1000)).toBe("overnight"));
});
