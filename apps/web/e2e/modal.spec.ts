import { expect, test } from "@playwright/test";

/*
 * The connect button must open something a person can see: a modal inside the viewport, above the app's own chrome,
 * at desktop and phone width. Found the hard way: the adapter's modal had no stylesheet and rendered at the foot of
 * the document, so a robot could click it and a person saw nothing.
 */
for (const [w, h] of [[1280, 900], [390, 844]] as const) {
  test(`connect wallet opens a visible modal at ${w}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await page.goto("/markets/NVDAx");
    await page.getByRole("button", { name: /connect wallet/i }).first().click();
    const modal = page.locator(".wallet-adapter-modal-wrapper");
    await expect(modal).toBeVisible();
    await page.waitForTimeout(400);
    const box = (await modal.boundingBox())!;
    expect(box.y).toBeGreaterThan(0);
    expect(box.y + box.height).toBeLessThanOrEqual(h);
    expect(box.x).toBeGreaterThanOrEqual(0);
    // The topmost element at the modal's centre is the modal, not the app's header or nav.
    const top = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest(".wallet-adapter-modal-wrapper") !== null, { x: box.x + box.width / 2, y: box.y + 20 });
    expect(top).toBe(true);
    await expect(page.getByRole("button", { name: /burner wallet/i })).toBeVisible();
    await page.screenshot({ path: `e2e/screenshots/wallet-modal-${w}.png` });
  });
}
