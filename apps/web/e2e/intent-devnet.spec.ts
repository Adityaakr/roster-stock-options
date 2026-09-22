import { test, expect } from "@playwright/test";

/*
 * The intent box on devnet: a sentence becomes a ticket, and reviewing it lands on the Act screen with the same term
 * and size. Needs OPENROUTER_API_KEY on the app; the box is absent without it and this test says so.
 */
test("intent: a sentence becomes a ticket on the Act screen", async ({ page }) => {
  await page.goto("/ask");
  const box = page.getByTestId("intent-go");
  // The box asks the app whether a key is set before it renders; give it a moment.
  const on = await box.waitFor({ state: "visible", timeout: 10_000 }).then(() => true).catch(() => false);
  if (!on) test.skip(true, "the intent box is off: no OPENROUTER_API_KEY");
  await page.getByTestId("intent-text").fill("$200 of Nvidia upside through Friday");
  await page.getByTestId("intent-go").click();
  const result = page.getByTestId("intent-result");
  await expect(result.or(page.getByTestId("intent-error"))).toBeVisible({ timeout: 60_000 });
  await expect(result).toBeVisible();
  await expect(result).toContainText("Buy an Upside on NVDAx");
  const size = (await result.locator(".intent-figs b").first().textContent())?.match(/\d+/)?.[0];
  await page.getByTestId("intent-review").click();
  await expect(page.getByRole("heading", { level: 1, name: /Upside at \$/ })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("size")).toHaveValue(size!);
});
