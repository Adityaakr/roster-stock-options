import { expect, test, type Locator, type Page } from "@playwright/test";
import { Connection, PublicKey } from "@solana/web3.js";

/*
 * The same journey as the fork flow, on a real cluster with no cheatcodes: connect a wallet, take test funds from the
 * app's own faucet, buy a Gap, buy a Floor, write a Floor and exercise, with every transaction signed in the page and
 * submitted by the app. The release is not here because it needs an expiry to pass, and devnet's clock is the real
 * one; the fork flow covers that.
 *
 * Runs only when the services report a devnet cluster, so it skips itself on the fork and on mainnet.
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

test.describe.configure({ mode: "serial" });

test("devnet: fund a wallet from the faucet, buy a Gap, buy a Floor, write and exercise", async ({ page }) => {
  test.setTimeout(600_000);
  const health = await fetch("http://127.0.0.1:8787/v1/health").then((r) => (r.ok ? r.json() : null)).catch(() => null);
  test.skip(!health || (health as { cluster?: string }).cluster !== "devnet", "services are not on devnet");
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const connection = new Connection(RPC, "confirmed");

  await page.goto("/markets/NVDAx");
  await expect(page.getByRole("heading", { level: 1, name: "NVDAx" })).toBeVisible();
  await expect(page.getByTestId("term-row").first()).toBeVisible({ timeout: 30_000 });

  // Connect the burner the test clusters offer, then take funds from the app's faucet: no cheatcode, no terminal.
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

  // Act: a Gap at the nearest expiry.
  await quotedRow(page).click();
  await expect(page.getByRole("heading", { level: 1, name: /Gap at/ })).toBeVisible();
  await page.getByTestId("size").fill("1");
  await expect(page.getByTestId("total")).not.toHaveText("n/a");
  await page.getByTestId("buy").click();
  expect((await waitDone(page)).length).toBeGreaterThan(10);

  // A Floor too.
  await page.getByRole("link", { name: "Markets" }).first().click();
  await page.getByRole("link", { name: /^NVDAx$/ }).first().click();
  await page.getByRole("tab", { name: /Floor · exit/ }).click();
  await quotedRow(page).click();
  await expect(page.getByRole("heading", { level: 1, name: /Floor at/ })).toBeVisible();
  await page.getByTestId("size").fill("1");
  await page.getByTestId("buy").click();
  await waitDone(page);

  // Commit: write a Floor of the same size the faucet handed out.
  await page.getByRole("link", { name: "Underwrite" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Underwrite" })).toBeVisible();
  const termSelect = page.getByTestId("term");
  const written = await termSelect.inputValue();
  await page.getByTestId("write-size").fill("1");
  await page.getByTestId("write-ask").fill("1.00");
  await page.getByTestId("write").click();
  await waitDone(page);
  // The slot appears once the indexer has read the deposit back; the term selection is restored first, because a
  // reload can land on a different term and the slot belongs to the one that was written.
  await expect.poll(async () => {
    await termSelect.selectOption(written).catch(() => undefined);
    await page.waitForTimeout(2_000);
    return await page.getByTestId("my-slot").isVisible().catch(() => false);
  }, { timeout: 120_000, intervals: [5_000] }).toBe(true);

  // Manage: exercise part of the Gap and see the receipt the indexer read back from the chain.
  await page.getByRole("link", { name: "Positions" }).first().click();
  await expect(page.getByTestId("position").first()).toBeVisible({ timeout: 60_000 });
  const gap = page.getByTestId("position").filter({ hasText: "Gap at" }).first();
  await gap.getByTestId("exercise").click();
  await gap.getByTestId("exercise-size").fill("0.5");
  await gap.getByTestId("exercise-confirm").click();
  await waitDone(page);
  await expect.poll(async () => {
    await page.getByTestId("refresh").click();
    await page.waitForTimeout(2_000);
    return (await page.getByTestId("history").textContent().catch(() => "")) ?? "";
  }, { timeout: 180_000, intervals: [5_000] }).toContain("Exercised");

  expect(errors, errors.join("\n")).toEqual([]);
});
