import { expect, test, type Page } from "@playwright/test";
import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, getAccount, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { FORK_URL, USDC_MINT, forkReachable, fundSol, fundTokenFor, resolveXstockMint } from "../../../scripts/fork-lib";

/*
 * M7 done-criterion: one Protected Buy round-trips on the fork. The burner wallet holds USDC only; after the one
 * transaction it holds the tokens Jupiter delivered and a Floor position on them. Needs fork, services, next dev.
 */
const connection = new Connection(FORK_URL, "confirmed");

async function connectBurner(page: Page): Promise<PublicKey> {
  await page.getByRole("button", { name: /connect wallet/i }).first().click();
  await page.getByRole("button", { name: /burner wallet/i }).click();
  const btn = page.getByTestId("wallet");
  await expect(btn).toBeVisible({ timeout: 20_000 });
  return new PublicKey((await btn.getAttribute("data-wallet"))!);
}

test("a Protected Buy delivers the tokens and the floor in one transaction", async ({ page }) => {
  test.setTimeout(300_000);
  const up = await forkReachable();
  const services = await fetch("http://127.0.0.1:8787/v1/health").then((r) => r.ok).catch(() => false);
  test.skip(!up || !services, "fork or services not running");
  await page.goto("/buy?m=NVDAx");
  await expect(page.getByRole("heading", { level: 1, name: "Protected Buy" })).toBeVisible();
  const wallet = await connectBurner(page);
  await fundSol(wallet, 20e9);
  await fundTokenFor(connection, wallet, USDC_MINT, TOKEN_PROGRAM_ID, 50_000n * 1_000_000n);
  const { mint, decimals } = await resolveXstockMint("NVDAx");
  await page.getByTestId("usdc-in").fill("500");
  await expect(page.getByTestId("pb-total")).not.toHaveText("…", { timeout: 30_000 });
  const total = await page.getByTestId("pb-total").textContent();
  await page.getByTestId("buy-floor").click();
  const done = page.getByTestId("tx-done");
  const failed = page.getByTestId("tx-failed");
  await expect(done.or(failed)).toBeVisible({ timeout: 120_000 });
  if (await failed.isVisible()) throw new Error(`protected buy failed: ${await failed.textContent()}`);
  // Tokens arrived and the position token exists.
  const tokenAta = getAssociatedTokenAddressSync(mint, wallet, false, TOKEN_2022_PROGRAM_ID);
  const bal = (await getAccount(connection, tokenAta, "confirmed", TOKEN_2022_PROGRAM_ID)).amount;
  expect(bal).toBeGreaterThan(0n);
  const usdc = (await getAccount(connection, getAssociatedTokenAddressSync(USDC_MINT, wallet), "confirmed", TOKEN_PROGRAM_ID)).amount;
  // Spent the 500 USDC swap plus the premium: less than 50,000 minus 500.
  expect(usdc).toBeLessThan(49_500n * 1_000_000n);
  const positions = await (await fetch(`http://127.0.0.1:3000/api/positions/${wallet.toBase58()}`)).json() as { positions: { side: string; shares: number }[] };
  const floor = positions.positions.find((p) => p.side === "put");
  expect(floor).toBeTruthy();
  console.log(`protected buy: ${Number(bal) / 10 ** decimals} NVDAx received, floor on ${floor!.shares} shares, total shown ${total}`);
});
