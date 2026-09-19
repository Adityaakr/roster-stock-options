import "./env-load";
/*
 * The registry job (Part 2 section 2, M5): for every candidate xStock, the issuer's facts from the xStocks API, the
 * mint read from the chain (the fork carries mainnet state), the Pyth feeds from Hermes' listing, and a verdict.
 * Writes fixtures/registry/registry.json (keeping escrow proofs from earlier runs) and docs/ELIGIBILITY.md.
 * `--all` walks every listed xStock instead of the proposed launch set; `--rpc` overrides the RPC.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { Connection, PublicKey } from "@solana/web3.js";
import { discoverWrappers, inspectMint, prestocksTokens, readRegistry, resolveFeeds, tesseraTokens, xstocksAsset, xstocksAssets, REGISTRY_PATH, TIER1_SET, TIER2_SET, type RegistryEntry, type RegistryFile, type Tier } from "../packages/registry/src";
import { FORK_URL } from "./fork-lib";

const args = new Set(process.argv.slice(2));
const RPC = process.env.RPC_URL ?? FORK_URL;

async function main() {
  const connection = new Connection(RPC, "confirmed");
  const previous = readRegistry();
  const proofs = new Map((previous?.entries ?? []).map((e) => [e.mint, e.escrowProof]));
  const candidates: { symbol: string; tier: Tier }[] = [...TIER1_SET.map((s) => ({ symbol: s, tier: 1 as Tier })), ...TIER2_SET.map((s) => ({ symbol: s, tier: 2 as Tier }))];
  if (args.has("--all")) {
    const known = new Set(candidates.map((c) => c.symbol));
    for (const a of await xstocksAssets()) if (!known.has(a.symbol)) candidates.push({ symbol: a.symbol, tier: 3 });
  }
  const entries: RegistryEntry[] = [];
  for (const c of candidates) {
    const asset = await xstocksAsset(c.symbol);
    if (!asset || !asset.mint) {
      console.warn(`${c.symbol}: not on the xStocks API or no Solana mint, skipped`);
      continue;
    }
    const inspection = await inspectMint(connection, new PublicKey(asset.mint));
    const feeds = await resolveFeeds(asset.symbol, asset.underlyingSymbol).catch((e) => { console.warn(`${c.symbol}: feeds: ${(e as Error).message}`); return { tokenFeed: null, equityFeed: null }; });
    entries.push({ symbol: asset.symbol, name: asset.name, underlyingSymbol: asset.underlyingSymbol, isin: asset.isin, logo: asset.logo, mint: asset.mint, tier: c.tier, wrapper: "xStock", holders: null, issuerMark: null, inspection, feeds, escrowProof: proofs.get(asset.mint) ?? null, issuerHalted: asset.isTradingHalted });
    console.log(`${asset.symbol.padEnd(7)} ${asset.mint} ${inspection.verdict.padEnd(18)} feed=${feeds.tokenFeed ? "yes" : "no"} eq=${feeds.equityFeed ? "yes" : "no"} ${inspection.reason}`);
    // Every other wrapper of the same stock on Solana (Jupiter's verified stock tags), so the app can show the choice
    // and the registry can judge each one: Tier 3 unless promoted by the authority.
    if (asset.underlyingSymbol) {
      for (const w of await discoverWrappers(asset.underlyingSymbol).catch((e) => { console.warn(`${asset.symbol}: wrapper discovery: ${(e as Error).message}`); return []; })) {
        if (w.mint === asset.mint || entries.some((x) => x.mint === w.mint)) continue;
        // A registry entry names its issuer; a wrapper from an issuer we do not model is discovered but not listed.
        if (w.issuer === "Other") { console.log(`${w.symbol.padEnd(7)} ${w.mint} skipped: issuer not modelled`); continue; }
        const wi = await inspectMint(connection, new PublicKey(w.mint));
        const wf = await resolveFeeds(w.symbol, asset.underlyingSymbol).catch(() => ({ tokenFeed: null, equityFeed: null }));
        entries.push({ symbol: w.symbol, name: w.name, underlyingSymbol: asset.underlyingSymbol, isin: asset.isin, logo: null, mint: w.mint, tier: 3, wrapper: w.issuer, holders: w.holders, issuerMark: null, inspection: wi, feeds: wf, escrowProof: proofs.get(w.mint) ?? null, issuerHalted: false });
        console.log(`${w.symbol.padEnd(7)} ${w.mint} ${wi.verdict.padEnd(18)} feed=${wf.tokenFeed ? "yes" : "no"} ${w.issuer} wrapper of ${asset.underlyingSymbol}: ${wi.reason}`);
      }
    }
  }
  // Pre-IPO (Part 2 section 2): tOpenAI, tKalshi, OPENAI and SPACEX at Tier 2, the rest of both registries at Tier 3.
  const preipoTier2 = new Set(["tOpenAI", "tKalshi", "OPENAI", "SPACEX"]);
  for (const t of [...(await tesseraTokens().catch((e) => { console.warn(`tessera: ${(e as Error).message}`); return []; })), ...(await prestocksTokens().catch((e) => { console.warn(`prestocks: ${(e as Error).message}`); return []; }))]) {
    if (!preipoTier2.has(t.symbol) && !args.has("--all")) continue;
    const inspection = await inspectMint(connection, new PublicKey(t.mint));
    const tier: Tier = preipoTier2.has(t.symbol) ? 2 : 3;
    entries.push({ symbol: t.symbol, name: t.name, underlyingSymbol: null, isin: null, logo: t.logo, mint: t.mint, tier, wrapper: t.issuer, holders: t.holders, issuerMark: { markPrice: t.markPrice, tokenPrice: t.tokenPrice, holders: t.holders, source: t.issuer === "Tessera" ? "rest-api.tessera.pe" : "prestocks.com/api" }, inspection, feeds: { tokenFeed: null, equityFeed: null }, escrowProof: proofs.get(t.mint) ?? null, issuerHalted: false });
    console.log(`${t.symbol.padEnd(7)} ${t.mint} ${inspection.verdict.padEnd(18)} ${t.issuer} mark=${t.markPrice} token=${t.tokenPrice} ${inspection.reason}`);
  }
  const file: RegistryFile = { generatedAt: new Date().toISOString(), cluster: RPC, entries };
  mkdirSync("fixtures/registry", { recursive: true });
  writeFileSync(REGISTRY_PATH, JSON.stringify(file, null, 2));
  writeFileSync("docs/ELIGIBILITY.md", report(file));
  console.log(`wrote ${REGISTRY_PATH} and docs/ELIGIBILITY.md (${entries.length} entries)`);
}

function report(f: RegistryFile): string {
  const rows = f.entries.map((e) => {
    const i = e.inspection;
    const ext = i.extensions.join(", ") || "none";
    const flags = [i.permanentDelegate ? "delegate" : null, i.pausable ? (i.pausable.paused ? "paused" : "pausable") : null, i.freezeAuthority ? "freeze" : null, i.transferFee ? `fee ${i.transferFee.bps} bps` : null, i.transferHook ? (i.transferHook.live ? "hook live" : "hook slot") : null].filter(Boolean).join(", ") || "none";
    const feeds = e.issuerMark ? `issuer mark (${e.issuerMark.source})` : `${e.feeds.tokenFeed ? "`" + e.feeds.tokenFeed.id.slice(0, 8) + "…`" : "none"} / ${e.feeds.equityFeed ? "`" + e.feeds.equityFeed.id.slice(0, 8) + "…`" : "none"}`;
    const proof = e.escrowProof ? `proven \`${e.escrowProof.quote.slice(0, 8)}…\`` : "not yet";
    return `| ${e.symbol} (${e.wrapper}) | Tier ${e.tier} | \`${e.mint}\` | ${i.decimals} | ${ext} | ${flags} | ${i.scaledUiAmount ? i.scaledUiAmount.multiplier.toFixed(6) : "n/a"} | ${feeds} | **${i.verdict}** | ${proof} | ${i.reason} |`;
  });
  return `# Eligibility

Generated ${f.generatedAt} by \`scripts/eligibility.ts\` against \`${f.cluster}\` (a surfpool fork carries mainnet account state). Mints come from the xStocks Assets API, extensions from the mint account, feeds from Hermes' listing endpoint, verdicts from the rule in \`packages/registry/src/eligibility.ts\`. The escrow proof column is written by \`scripts/list-markets.ts\` when a series is created, one lot quoted into the vault and withdrawn on the fork; a mint is never listed before that.

**Verdicts.** \`eligible\`: plain Token-2022 or SPL mint, escrow proven. \`eligible_with_fee\`: transfer fee; Gaps only until fee-inclusive settlement (First Print). \`restricted_wrapper\`: a live transfer hook whose extra accounts are not yet proven. \`ineligible\`: cannot be escrowed (fewer than six decimals, non-transferable, not a token).

**Tier 2 grid.** The quoter runs Tier 2 on the nearest expiry only, three strikes a side, with lower caps (\`scripts/list-markets.ts\` sets \`max_live_series\` 6, \`max_lots6\` 2,000, \`max_writer_lots6\` 1,000); Tier 1 runs both expiries at 12 series. Promotion is a registry change by the authority, not automatic (Part 2 section 2).

**Backpack entitlements.** Held: not on the xStocks API, no Solana mint resolved from an issuer source; listed only when its escrow check passes (Part 2 section 2).

| Symbol | Tier | Mint | Dec | Extensions | Flags | Multiplier | Token feed / equity feed | Verdict | Escrow | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
${rows.join("\n")}
`;
}

main().catch((e) => { console.error(e); process.exit(1); });
