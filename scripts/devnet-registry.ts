import "./env-load";
/*
 * The devnet registry: one entry per replica mint created by scripts/devnet-mints.ts, with the chain's own facts read
 * back from devnet and a mark that comes from the mainnet counterpart (docs/DEVNET.md). The shape is the mainnet
 * registry's, so every consumer — list-markets, the services, the app — reads devnet through the same code.
 *
 * Feeds are null on purpose: Pyth Core refuses every feed this product needs without a paid grant, so a devnet market
 * is priced from its issuer's quote and the Tokens API snapshot, and the app says which source priced each mark.
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Connection, PublicKey } from "@solana/web3.js";
import { inspectMint, marketSnapshots, registryPathFor, resolveAsset, tesseraTokens, tokensApiKeyed, xstocksQuote, type RegistryEntry, type RegistryFile, type Tier } from "../packages/registry/src";
import { resolveXstockMint } from "./fork-lib";
import type { DevnetMints } from "./devnet-mints";

const RPC = process.env.DEVNET_RPC_URL ?? "https://api.devnet.solana.com";
const MINTS = resolve(process.cwd(), "fixtures/devnet-mints.json");
const OUT = registryPathFor("devnet");
/** Tier 1 gets treasury quotes on both sides; the rest are quoted thinner, exactly as on mainnet. */
const TIER: Record<string, Tier> = { NVDAx: 1, TSLAx: 1, SPYx: 1 };

async function main(): Promise<void> {
  if (!existsSync(MINTS)) throw new Error(`${MINTS} missing: run pnpm devnet:mints first`);
  const devnet = JSON.parse(readFileSync(MINTS, "utf8")) as DevnetMints;
  const connection = new Connection(RPC, "confirmed");
  console.log(`[devnet-registry] ${RPC}, ${devnet.mints.length} replicas`);

  // One batched call for every mainnet counterpart: a real price, change and holder count per wrapper.
  const counterparts = new Map<string, string>();
  for (const m of devnet.mints.filter((x) => x.wrapper === "xStock")) {
    const real = await resolveXstockMint(m.symbol).catch(() => null);
    if (real) counterparts.set(m.symbol, real.mint.toBase58());
  }
  const snaps = tokensApiKeyed() ? await marketSnapshots([...counterparts.values()]).catch(() => new Map()) : new Map();
  // The First Print replica takes its mark from the issuer that publishes one, exactly as its mainnet counterpart does.
  const tessera = await tesseraTokens().catch(() => []);

  // A rebuild refreshes facts, never erases proof: an escrow round trip already run on this mint still counts.
  const previous = new Map((existsSync(OUT) ? (JSON.parse(readFileSync(OUT, "utf8")) as RegistryFile).entries : []).map((e) => [e.mint, e]));
  const entries: RegistryEntry[] = [];
  for (const m of devnet.mints) {
    const inspection = await inspectMint(connection, new PublicKey(m.mint));
    const issuerToken = m.wrapper === "Tessera" ? tessera.find((t) => t.symbol.toLowerCase() === m.symbol.toLowerCase()) ?? null : null;
    const mainnetMint = counterparts.get(m.symbol) ?? issuerToken?.mint ?? null;
    const snap = mainnetMint ? snaps.get(mainnetMint) : undefined;
    const issuer = issuerToken;
    const perShare = issuer?.markPrice ?? snap?.price ?? (await xstocksQuote(m.symbol).catch(() => null));
    const tier: Tier = TIER[m.symbol] ?? 2;
    const asset = mainnetMint && tokensApiKeyed() ? await resolveAsset(mainnetMint).catch(() => null) : null;
    entries.push({
      symbol: m.symbol,
      name: m.name,
      underlyingSymbol: m.underlyingSymbol,
      isin: null,
      logo: snap?.logo ?? null,
      mint: m.mint,
      tier,
      wrapper: m.wrapper,
      holders: snap?.holders ?? null,
      // The mark is the counterpart's, and `source` says so on every ticket.
      issuerMark: { markPrice: perShare ?? null, tokenPrice: perShare ?? null, holders: issuer?.holders ?? snap?.holders ?? null, source: issuer ? "tessera mainnet mark" : snap ? "tokens.xyz mainnet snapshot" : "xstocks mainnet quote" },
      inspection,
      feeds: { tokenFeed: null, equityFeed: null },
      escrowProof: previous.get(m.mint)?.escrowProof ?? null,
      issuerHalted: false,
      replicaOf: mainnetMint,
    });
    console.log(`${m.symbol.padEnd(8)} ${m.mint} ${inspection.verdict.padEnd(18)} mark ${perShare ? `$${perShare.toFixed(2)}` : "none"} ${asset ? `asset=${asset.assetId}${asset.stockVariantTier ? ` tier=${asset.stockVariantTier}` : ""}` : ""}`);
  }

  const file: RegistryFile = { generatedAt: new Date().toISOString(), cluster: "devnet", entries };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(file, null, 2)}\n`);
  console.log(`[devnet-registry] ${entries.length} entries in ${OUT}`);
}

await main();
