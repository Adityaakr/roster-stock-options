import { expect, test, type Locator, type Page } from "@playwright/test";
import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { FORK_URL, USDC_MINT, clockUnix, forkReachable, fundSol, fundTokenFor, resolveXstockMint, servicesWarm, timeTravelTo } from "../../../scripts/fork-lib";

/*
 * M4 done-criterion (docs/02-roadmap.md): a person buys a Gap, buys a Floor, writes a Floor, exercises, and sees the
 * release, in a browser with no terminal. The burner wallet the app offers on the fork is funded through the fork's
 * cheatcodes; every other step is the UI. Needs the fork, the program, the services (:8787) and next dev (:3000).
 */
const connection = new Connection(FORK_URL, "confirmed");

/** The first term in the grid that someone can actually buy: an unquoted strike is a row with no premium. */
function quotedRow(page: Page): Locator {
  return page.getByTestId("term-row").filter({ hasNotText: "not fillable" }).filter({ hasNotText: "no ask resident" }).first();
}

async function connectBurner(page: Page): Promise<PublicKey> {
  await page.getByRole("button", { name: /connect wallet/i }).first().click();
  await page.getByRole("button", { name: /burner wallet/i }).click();
  const btn = page.getByTestId("wallet");
  await expect(btn).toBeVisible({ timeout: 20_000 });
  return new PublicKey((await btn.getAttribute("data-wallet"))!);
}

async function fund(wallet: PublicKey): Promise<void> {
  const { mint, decimals } = await resolveXstockMint("NVDAx");
  await fundSol(wallet, 20e9);
  await fundTokenFor(connection, wallet, mint, TOKEN_2022_PROGRAM_ID, 100n * 10n ** BigInt(decimals));
  await fundTokenFor(connection, wallet, USDC_MINT, TOKEN_PROGRAM_ID, 50_000n * 1_000_000n);
}

async function waitDone(page: Page): Promise<string> {
  const done = page.getByTestId("tx-done").last();
  const failed = page.getByTestId("tx-failed").last();
  await expect(done.or(failed)).toBeVisible({ timeout: 90_000 });
  if (await failed.isVisible()) throw new Error(`transaction failed: ${await failed.textContent()}`);
  return (await page.getByTestId("tx-signature").last().textContent()) ?? "";
}

test.describe.configure({ mode: "serial" });

test("buy a Gap, buy a Floor, write a Floor, exercise, see the release", async ({ page }) => {
  test.setTimeout(600_000);
  const up = await forkReachable();
  const services = await servicesWarm();
  test.skip(!up || !services, "fork or services not running");
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  // Discover: the market list, then the Gap grid of NVDAx.
  await page.goto("/markets/NVDAx");
  await expect(page.getByRole("heading", { level: 1, name: "NVDAx" })).toBeVisible();
  await expect(page.getByTestId("term-row").first()).toBeVisible({ timeout: 30_000 });
  const wallet = await connectBurner(page);
  await fund(wallet);

  // Act: a Gap at the nearest expiry, size 2, one transaction.
  await quotedRow(page).click();
  await expect(page.getByRole("heading", { level: 1, name: /Gap at/ })).toBeVisible();
  await page.getByTestId("size").fill("2");
  await expect(page.getByTestId("total")).not.toHaveText("n/a");
  await page.getByTestId("buy").click();
  const buySig = await waitDone(page);
  expect(buySig.length).toBeGreaterThan(10);

  // A Floor too.
  await page.getByRole("link", { name: "Markets" }).first().click();
  await page.getByRole("link", { name: /^NVDAx$/ }).first().click();
  await page.getByRole("tab", { name: /Floor · exit/ }).click();
  await quotedRow(page).click();
  await expect(page.getByRole("heading", { level: 1, name: /Floor at/ })).toBeVisible();
  await page.getByTestId("size").fill("2");
  await page.getByTestId("buy").click();
  await waitDone(page);

  // Commit: write a Floor, 3 shares at 1.00 per share; the slot appears with the ask resident.
  await page.getByRole("link", { name: "Earn" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Get paid to take the other side" })).toBeVisible();
  const termSelect = page.getByTestId("term");
  const written = await termSelect.inputValue();
  await page.getByTestId("write-size").fill("3");
  await page.getByTestId("write-ask").fill("1.00");
  await page.getByTestId("write").click();
  await waitDone(page);
  await expect(page.getByTestId("my-slot")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("my-slot")).toContainText("3 NVDAx in 1 ask");

  // Manage: both positions are there; exercise one share of the Gap, restating the exchange.
  await page.getByRole("link", { name: "Positions" }).first().click();
  await expect(page.getByTestId("position").first()).toBeVisible({ timeout: 30_000 });
  const gap = page.getByTestId("position").filter({ hasText: "Gap at" }).first();
  await expect(gap).toContainText("pay $");
  await gap.getByTestId("exercise").click();
  await gap.getByTestId("exercise-size").fill("1");
  await gap.getByTestId("exercise-confirm").click();
  await waitDone(page);
  // The burner wallet lives in the page, so never reload: refresh in place until the indexer has the event.
  await expect.poll(async () => {
    await page.getByTestId("refresh").click();
    await page.waitForTimeout(1500);
    return (await page.getByTestId("history").textContent().catch(() => "")) ?? "";
  }, { timeout: 120_000, intervals: [5_000] }).toContain("Exercised");

  // The release: travel past the written term's expiry, the keeper settles every writer, the receipt appears.
  const expiry = Number(written.split("-").pop());
  await timeTravelTo(Math.max(await clockUnix(connection), expiry) + 5);
  await expect.poll(async () => {
    await page.getByTestId("refresh").click();
    await page.waitForTimeout(1500);
    return (await page.getByTestId("history").textContent().catch(() => "")) ?? "";
  }, { timeout: 240_000, intervals: [5_000] }).toContain("Released");
  const released = page.getByTestId("history").locator("tr[data-kind=release]").first();
  await expect(released).toContainText("not assigned");
  expect(errors, errors.join("\n")).toEqual([]);
});
