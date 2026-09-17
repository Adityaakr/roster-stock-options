import { describe, expect, it } from "vitest";
import { blend, realisedVol } from "./benchmarks";

describe("realised volatility", () => {
  it("is null on too little data and finite on a series", () => {
    expect(realisedVol([1, 2])).toBeNull();
    const v = realisedVol([100, 101, 99.5, 102, 101.2, 103, 102.5, 104]);
    expect(v).not.toBeNull();
    expect(v!).toBeGreaterThan(0);
  });
  it("blends the available windows and floors", () => {
    expect(blend(0.4, 0.5, null, 0.2).blended).toBeCloseTo((0.4 * 0.5 + 0.5 * 0.3) / 0.8, 9);
    expect(blend(null, null, null, 0.35)).toEqual({ blended: 0.35, source: "floor" });
    expect(blend(0.1, 0.1, 0.1, 0.3).blended).toBe(0.3);
  });
});
