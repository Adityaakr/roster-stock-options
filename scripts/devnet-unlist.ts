import "./env-load";
/*
 * Unlist a devnet market by mint: `update_market(listed = false)`. A market cannot be closed on chain (there is no
 * close_market), so this is how one leaves the product: the services stop quoting it, the registry no longer carries
 * it, and its accounts stay visible to anyone who looks (docs/03-prestocks-decision.md).
 */
import { Connection, PublicKey } from "@solana/web3.js";
import * as anchorNs from "@anchor-lang/core";
import { RosterClient } from "../packages/sdk/src";
import { DEVNET_RPC } from "./devnet-lib";
import { loadOrCreateKey } from "./fork-lib";

const anchor = ((anchorNs as { default?: unknown }).default ?? anchorNs) as typeof anchorNs;

async function main(): Promise<void> {
  const mints = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (!mints.length) throw new Error("usage: tsx scripts/devnet-unlist.ts <mint> [mint...]");
  const connection = new Connection(DEVNET_RPC, "confirmed");
  const deployer = loadOrCreateKey("deployer");
  const c = new RosterClient(connection, new anchor.Wallet(deployer));
  for (const m of mints) {
    const mint = new PublicKey(m);
    const market = await c.fetchMarket(mint);
    if (!market) { console.log(`${m}: no market`); continue; }
    if (!market.listed) { console.log(`${m}: already unlisted`); continue; }
    const sig = await c.send(await c.updateMarket(mint, { listed: false }));
    console.log(`${m}: unlisted (${sig})`);
  }
}

await main();
