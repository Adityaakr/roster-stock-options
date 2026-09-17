import { test } from "@playwright/test";

/** The product frames the landing page swaps through: the main content area at 2x, 1040 x 780, like the reference's 2080 x 1560 frames. */
const frames = [
  { path: "/trade", name: "trade", wait: "table.table" },
  { path: "/trade/call-180-EXP", name: "act", wait: ".chart svg" },
  { path: "/positions", name: "positions", wait: ".card" },
  { path: "/underwrite", name: "underwrite", wait: "table.table" }
] as const;

for (const f of frames) {
  test(`frame ${f.name}`, async ({ page, request }) => {
    let path: string = f.path;
    if (path.includes("EXP")) {
      const d = (await (await request.get("/api/roster")).json()) as { expiries: number[] };
      path = path.replace("EXP", String(d.expiries[0]));
    }
    await page.goto(path);
    await page.locator(f.wait).first().waitFor({ timeout: 55_000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `public/frames/${f.name}.png`, clip: { x: 240, y: 0, width: 1040, height: 780 } });
  });
}
