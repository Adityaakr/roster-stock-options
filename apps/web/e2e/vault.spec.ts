import { expect, test } from "@playwright/test";

/*
 * Part 3 in a browser on devnet: a person funds a wallet, queues a deposit into the Covered Call vault and sees it in
 * the queue with the roll time; buys a Gap the vault wrote; sells it back to the vault at the vault's bid without
 * paying the strike. The roll itself happens on the calendar and is covered by the program tests.
 */
test.describe.configure({ mode: "serial" });

test("devnet: deposit into the vault, buy from it, sell back to it", async ({ page }) => {
  test.setTimeout(600_000);
  const health = await fetch("http://127.0.0.1:8787/v1/health").then((r) => (r.ok ? r.json() : null)).catch(() => null);
  test.skip(!health || (health as { cluster?: string }).cluster !== "devnet", "services are not on devnet");
  const vaults = (await fetch("http://127.0.0.1:8787/v1/vaults").then((r) => r.json())) as { symbol: string; kind: string; totalShares: string }[];
  const cc = vaults.find((v) => v.symbol === "NVDAx" && v.kind === "covered_call");
  test.skip(!cc || cc.totalShares === "0", "the NVDAx covered-call vault has not rolled yet");
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/vaults");
  await expect(page.getByRole("heading", { level: 1, name: "Vaults" })).toBeVisible();
  await expect(page.getByTestId("vault").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/paid risk, not yield/i).first()).toBeVisible();

  // Connect the burner and take funds.
  await page.getByRole("button", { name: /connect wallet/i }).first().click();
  await page.getByRole("button", { name: /burner wallet/i }).click();
  const walletBtn = page.getByTestId("wallet");
  await expect(walletBtn).toBeVisible({ timeout: 20_000 });
  await walletBtn.click();
  await page.getByTestId("faucet").click();
  await expect(page.getByTestId("faucet")).toContainText(/Funded/, { timeout: 120_000 });
  await page.keyboard.press("Escape");
  await page.mouse.click(5, 5);

  // Queue 2 NVDAx into the covered-call vault: it shows in the queue with the roll it enters at.
  const card = page.getByTestId("vault").filter({ hasText: "Covered Call · NVDAx" }).first();
  await card.getByTestId("vault-amount").fill("2");
  await card.getByTestId("vault-deposit").click();
  await expect(card.getByTestId("tx-done").or(card.getByTestId("tx-failed"))).toBeVisible({ timeout: 120_000 });
  expect(await card.getByTestId("tx-failed").isVisible()).toBe(false);
  await expect(card.getByTestId("my-queued-deposit")).toContainText("2", { timeout: 60_000 });

  // Buy a Gap the vault is asking on. In-app navigation: the burner lives in the page and a full load would replace it.
  await page.getByRole("link", { name: "Markets" }).first().click();
  await page.getByRole("link", { name: /^NVDAx$/ }).first().click();
  await page.getByTestId("buy-gap").click();
  await expect(page.getByRole("heading", { level: 1, name: /Gap at/ })).toBeVisible();
  await page.getByTestId("size").fill("1");
  await expect(page.getByTestId("total")).not.toHaveText("n/a");
  await page.getByTestId("buy").click();
  await expect(page.getByTestId("tx-done").last().or(page.getByTestId("tx-failed").last())).toBeVisible({ timeout: 120_000 });
  expect(await page.getByTestId("tx-failed").last().isVisible()).toBe(false);

  // Sell it back to the vault at the bid, once the quoter has posted one (it refreshes every tick).
  await page.getByRole("link", { name: "Positions" }).first().click();
  await expect(page.getByTestId("position").first()).toBeVisible({ timeout: 60_000 });
  const gap = page.getByTestId("position").filter({ hasText: "Gap at" }).first();
  await expect.poll(async () => {
    await page.getByTestId("refresh").click();
    await page.waitForTimeout(3_000);
    return gap.getByTestId("sell-to-vault").isVisible().catch(() => false);
  }, { timeout: 180_000, intervals: [10_000] }).toBe(true);
  await gap.getByTestId("sell-to-vault").click();
  await expect(gap.getByTestId("tx-done").or(gap.getByTestId("tx-failed"))).toBeVisible({ timeout: 120_000 });
  expect(await gap.getByTestId("tx-failed").isVisible()).toBe(false);
  expect(errors, errors.join("\n")).toEqual([]);
});
