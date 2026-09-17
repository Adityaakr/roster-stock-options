import "server-only";
import { DEFAULT_SIZE, nextFridays, sessionAt, termId, type ExerciseEvent, type Position, type RosterData, type Side, type Term, type Underwriter } from "./model";

/*
 * The data the app renders, assembled server-side. On the `fixture` cluster (the only one until P0 lands) every
 * figure is a test fixture and the UI says so in the cluster badge and under every instrument. Expiries and the
 * session come from the real clock, so the countdowns, the session badge and the "open on Saturday" claim are live.
 * P2 replaces `fixtureTerms()` with the indexer read and the executable-protection endpoint; the shape stays.
 */

const FIXTURE_MARK = 182.3;

/** Premium per share by side, strike and expiry rank (0 = nearest Friday). Chosen so the worked examples in CLAUDE.md 6 hold. */
const PREMIUM: Record<Side, Record<number, [number, number]>> = {
  call: { 180: [5.4, 8.1], 185: [2.9, 5.6], 190: [1.45, 3.7] },
  put: { 180: [3.0, 5.3], 175: [1.35, 3.2], 170: [0.6, 1.85] }
};

function fixtureTerms(expiries: number[]): Term[] {
  const out: Term[] = [];
  expiries.forEach((exp, rank) => {
    for (const side of ["call", "put"] as const) {
      for (const [k, prem] of Object.entries(PREMIUM[side])) {
        const strike = Number(k);
        const ask = prem[rank === 0 ? 0 : 1];
        const step = Math.max(0.05, Math.round(ask * 0.04 * 100) / 100);
        out.push({
          id: termId(side, strike, exp),
          side,
          strike,
          expiryTs: exp,
          ask,
          ladder: [
            { size: 10, ask, underwriters: 1 },
            { size: 50, ask: Math.round((ask + step) * 100) / 100, underwriters: 2 },
            { size: 200, ask: Math.round((ask + step * 3) * 100) / 100, underwriters: 3 }
          ],
          capacity: side === "call" ? 260 : 320,
          openInterest: rank === 0 ? (strike === 180 ? 140 : 40) : 20
        });
      }
    }
  });
  return out;
}

const UNDERWRITERS: Underwriter[] = [
  { name: "Roster treasury", kind: "treasury", account: null, usdcReserved: 118_800, underlyingReserved: 420, live: true },
  { name: "Maker bot", kind: "maker", account: null, usdcReserved: 54_000, underlyingReserved: 180, live: true },
  { name: "External underwriter", kind: "external", account: null, usdcReserved: 0, underlyingReserved: 0, live: false }
];

function fixturePositions(expiries: number[]): Position[] {
  const near = expiries[0] ?? 0;
  const far = expiries[1] ?? near;
  return [
    { id: "pos-1", termId: termId("call", 180, near), side: "call", strike: 180, expiryTs: near, shares: 10, premiumPaid: 54, exercised: 0, signature: null },
    { id: "pos-2", termId: termId("put", 180, far), side: "put", strike: 180, expiryTs: far, shares: 20, premiumPaid: 106, exercised: 0, signature: null }
  ];
}

function fixtureExercises(now: number, expiries: number[]): ExerciseEvent[] {
  const near = expiries[0] ?? now;
  return [
    { ts: now - 2 * 86_400, termId: termId("call", 180, near), shares: 5, kind: "exercise", ok: true, signature: null, note: "paid 900.00 USDC, received 5 NVDAx" },
    { ts: now - 86_400, termId: termId("put", 175, near), shares: 10, kind: "auto_exercise", ok: false, signature: null, note: "declined: out of the money by more than the keeper fee" }
  ];
}

export async function rosterData(): Promise<RosterData> {
  const now = Math.floor(Date.now() / 1000);
  const expiries = nextFridays(now, 2);
  const session = sessionAt(now);
  const equityOpen = session === "regular";
  return {
    cluster: "fixture",
    clusterLabel: "Fixture",
    programDeployed: false,
    nowTs: now,
    session,
    underlying: {
      symbol: "NVDAx",
      name: "Nvidia xStock",
      mint: null,
      mark: FIXTURE_MARK,
      equityMark: equityOpen ? 182.08 : null,
      basisBps: equityOpen ? 12 : null,
      multiplier: 1,
      pendingActivationTs: null,
      wrapperTier: "xStock"
    },
    expiries,
    terms: fixtureTerms(expiries),
    underwriters: UNDERWRITERS,
    positions: fixturePositions(expiries),
    exercises: fixtureExercises(now, expiries),
    feeBps: 25,
    keeperFeeUsd: 2,
    source: "Fixture cluster. Premiums, marks, reserves and positions are test fixtures; expiries and the session badge follow the clock. Mint, feed ids and escrow accounts are recorded in P0 and never invented."
  };
}

export { DEFAULT_SIZE };
