/*
 * The registry file the fork and the services read: one entry per candidate market with the issuer's facts, the
 * chain's facts, the feeds, the tier and the verdict. Written by scripts/eligibility.ts, never edited by hand.
 */
import { readFileSync, existsSync } from "node:fs";
import type { MintInspection } from "./eligibility";
import type { ResolvedFeeds } from "./feeds";

export type Tier = 1 | 2 | 3;

/** The proposed launch set (Part 2 section 2), subject to each mint's verdict. */
export const TIER1_SET = ["NVDAx", "TSLAx", "SPYx"];
export const TIER2_SET = ["AAPLx", "MSFTx", "GOOGLx", "AMZNx", "METAx", "CRCLx", "MSTRx", "QQQx"];

export interface RegistryEntry {
  symbol: string;
  name: string;
  underlyingSymbol: string | null;
  isin: string | null;
  logo: string | null;
  mint: string;
  tier: Tier;
  wrapper: "xStock";
  inspection: MintInspection;
  feeds: ResolvedFeeds;
  /** The escrow round trip on the fork: series created, one lot quoted, withdrawn. Signatures when proven. */
  escrowProof: { series: string; quote: string; withdraw: string; provenAt: string } | null;
  issuerHalted: boolean;
}

export interface RegistryFile {
  generatedAt: string;
  cluster: string;
  entries: RegistryEntry[];
}

export const REGISTRY_PATH = "fixtures/registry/registry.json";

export function readRegistry(path = REGISTRY_PATH): RegistryFile | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as RegistryFile;
}

/** Markets the services should run: eligible (or eligible with fee) with a token feed and a proven escrow. */
export function listable(r: RegistryFile): RegistryEntry[] {
  return r.entries.filter((e) => (e.inspection.verdict === "eligible" || e.inspection.verdict === "eligible_with_fee") && e.feeds.tokenFeed && e.escrowProof);
}
