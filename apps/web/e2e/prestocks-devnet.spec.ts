import { expect, test, type Locator, type Page } from "@playwright/test";
import { Connection, PublicKey } from "@solana/web3.js";

/*
 * The PreStocks journey on devnet, in a browser with no terminal: take test funds, open OPENAI on the desk, buy a
 * Floor (the funded exit), exercise it delivering the mint's fee on top, and see the receipt. Every figure the page
 * shows for a transfer-fee mint is asserted in words: the exercise line says "plus the mint's 0.50% fee".
 *
 * Runs only when the services report a devnet cluster with an OPENAI market.
 */
const RPC = process.env.DEVNET_RPC_URL ?? "https://api.devnet.solana.com";

function quotedRow(page: Page): Locator {
  return page.getByTestId("term-row").filter({ hasNotText: "not fillable" }).filter({ hasNotText: "no ask resident" }).first();
}
async function waitDone(page: Page): Promise<string> {
  const done = page.getByTestId("tx-done").last();
  const failed = page.getByTestId("tx-failed").last();
  await expect(done.or(failed)).toBeVisible({ timeout: 120_000 });
  if (await failed.isVisible()) throw new Error(`transaction failed: ${await failed.textContent()}`);
  return (await page.getByTestId("tx-signature").last().textContent()) ?? "";
}

test("devnet: buy a Floor on OPENAI from the PreStocks desk, exercise it with the fee delivered on top", async ({ page }) => {
  test.setTimeout(600_000);
  const roster = await fetch("http://127.0.0.1:8787/v1/roster").then((r) => (r.ok ? r.json() : null)).catch(() => null) as { cluster?: string; markets?: { symbol: string }[] } | null;
  test.skip(!roster || roster.cluster !== "devnet" || !roster.markets?.some((m) => m.symbol === "OPENAI"), "services are not on devnet with OPENAI listed");
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const connection = new Connection(RPC, "confirmed");

  // The desk: eight tokens, two listed, the spread chart, OPENAI's card.
  await page.goto("/pre-ipo");
  await expect(page.getByRole("heading", { level: 1, name: "PreStocks" })).toBeVisible();
  await expect(page.getByTestId("preipo-row")).toHaveCount(8, { timeout: 60_000 });
  await expect(page.getByTestId("preipo-row").filter({ hasText: "listed" }).filter({ hasNotText: "not listed" })).toHaveCount(2);
  const openai = page.getByTestId("preipo-row").filter({ hasText: "OPENAI" }).first();
  await expect(openai).toContainText("live series");
  await expect(openai).toContainText("0.50%");

  // Funds from the faucet, through the wallet menu.
  await page.getByRole("button", { name: /connect wallet/i }).first().click();
  await page.getByRole("button", { name: /burner wallet/i }).click();
  const walletBtn = page.getByTestId("wallet");
  await expect(walletBtn).toBeVisible({ timeout: 20_000 });
  const wallet = new PublicKey((await walletBtn.getAttribute("data-wallet"))!);
  await walletBtn.click();
  await page.getByTestId("faucet").click();
  await expect(page.getByTestId("faucet")).toContainText(/Funded/, { timeout: 120_000 });
  await expect.poll(async () => connection.getBalance(wallet, "confirmed").catch(() => 0), { timeout: 120_000, intervals: [3_000] }).toBeGreaterThan(0);
  await page.keyboard.press("Escape");
  await page.mouse.click(5, 5);

  // The token page: token price and mark, the chart, and a quoted Floor.
  await openai.click();
  await expect(page.getByRole("heading", { level: 1, name: "OPENAI" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("No exchange session")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/Token vs issuer mark/)).toBeVisible();
  await page.getByRole("tab", { name: /Floor · exit/ }).click();
  await quotedRow(page).click();
  await expect(page.getByRole("heading", { level: 1, name: /Floor at/ })).toBeVisible();
  await page.getByTestId("size").fill("1");
  await expect(page.getByTestId("total")).not.toHaveText("n/a");
  await page.getByTestId("buy").click();
  expect((await waitDone(page)).length).toBeGreaterThan(10);

  // Manage: the exercise line states the gross delivery; exercise half a token.
  await page.getByRole("link", { name: "Positions" }).first().click();
  await expect(page.getByTestId("position").first()).toBeVisible({ timeout: 60_000 });
  const floor = page.getByTestId("position").filter({ hasText: "Floor at" }).filter({ hasText: "OPENAI" }).first();
  await expect(floor).toContainText("plus the mint's 0.50% fee");
  await floor.getByTestId("exercise").click();
  await floor.getByTestId("exercise-size").fill("0.5");
  await floor.getByTestId("exercise-confirm").click();
  await waitDone(page);
  await expect.poll(async () => {
    await page.getByTestId("refresh").click();
    await page.waitForTimeout(2_000);
    return (await page.getByTestId("history").textContent().catch(() => "")) ?? "";
  }, { timeout: 180_000, intervals: [5_000] }).toContain("Exercised");

  expect(errors, errors.join("\n")).toEqual([]);
});
