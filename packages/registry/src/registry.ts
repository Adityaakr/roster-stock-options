/*
 * The registry file the fork and the services read: one entry per candidate market with the issuer's facts, the
 * chain's facts, the feeds, the tier and the verdict. Written by scripts/eligibility.ts, never edited by hand.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
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
  wrapper: "xStock" | "Ondo" | "PreStocks";
  /** Holder count where an issuer or Jupiter publishes one. */
  holders: number | null;
  /** For pre-IPO tokens with no Pyth feed: the issuer's mark and token price at registry time, and where they came from. */
  issuerMark: { markPrice: number | null; tokenPrice: number | null; holders: number | null; source: string } | null;
  inspection: MintInspection;
  feeds: ResolvedFeeds;
  /** The escrow round trip on the fork: series created, one lot quoted, withdrawn. Signatures when proven. */
  escrowProof: { series: string; quote: string; withdraw: string; provenAt: string } | null;
  /** Devnet only: the mainnet mint this replica stands in for, and where its mark comes from (docs/DEVNET.md). */
  replicaOf?: string | null;
  issuerHalted: boolean;
}

export interface RegistryFile {
  generatedAt: string;
  cluster: string;
  entries: RegistryEntry[];
}

/** The repo root is the directory holding pnpm-workspace.yaml, so the file resolves the same from any package's cwd. */
function repoRoot(from = process.cwd()): string {
  let dir = from;
  for (let i = 0; i < 8; i++) {
    if (existsSync(resolve(dir, "pnpm-workspace.yaml"))) return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return from;
}
export const REGISTRY_PATH = resolve(repoRoot(), "fixtures/registry/registry.json");

/** One registry per cluster: devnet lists replica mints (docs/DEVNET.md), and the two must never be mixed up. */
export function registryPathFor(cluster: string): string {
  return cluster === "devnet" ? resolve(repoRoot(), "fixtures/registry/registry.devnet.json") : REGISTRY_PATH;
}

export function readRegistry(path = REGISTRY_PATH): RegistryFile | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as RegistryFile;
}

/** Markets the services should run: eligible (or eligible with fee), priced by a Pyth feed or an issuer mark, escrow proven. */
export function listable(r: RegistryFile): RegistryEntry[] {
  return r.entries.filter((e) => (e.inspection.verdict === "eligible" || e.inspection.verdict === "eligible_with_fee") && (e.feeds.tokenFeed || e.issuerMark) && e.escrowProof);
}
