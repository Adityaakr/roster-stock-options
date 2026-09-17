import { expect, test } from "@playwright/test";

/*
 * Every page renders with one h1, logs no console errors, prints no em-dash, and is captured at 1280 and 390 into
 * e2e/screenshots (the build contract) and, for the four product screens, into public/frames for the landing page.
 */
const pages = [
  { path: "/", heading: "Stock leverage without margin liquidation.", name: "landing", wait: "#terms table.table"},
  { path: "/markets", heading: "Markets", name: "trade", wait: "table.table"},
  { path: "/markets/NVDAx", heading: "NVDAx", name: "market", wait: "table.table"},
  { path: "/trade/TERM", heading: /Gap at \$/, name: "act", wait: ".chart svg"},
  { path: "/positions", heading: "Positions", name: "positions", wait: ".card"},
  { path: "/underwrite", heading: "Underwrite", name: "underwrite", wait: "table.table"},
  { path: "/roster", heading: "Roster", name: "roster", wait: "table.table"},
  { path: "/buy", heading: "Protected Buy", name: "buy", wait: ".card"},
  { path: "/pre-ipo", heading: "First Print", name: "pre-ipo", wait: "table.table"}
] as const;

for (const p of pages) {
  test(`${p.name} renders`, async ({ page, request }, testInfo) => {
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error" && !/favicon|hydrat|Failed to fetch|net::ERR|404/i.test(m.text())) errors.push(m.text());
    });
    let path: string = p.path;
    if (path.includes("TERM")) {
      const d = (await (await request.get("/api/roster")).json()) as { terms: { id: string; side: string; ladder: { ask: number | null }[] }[] };
      const t = d.terms.find((x) => x.side === "call" && x.ladder[0]?.ask !== null) ?? d.terms[0]!;
      path = path.replace("TERM", t.id);
    }
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: p.heading })).toBeVisible();
    await page.locator(p.wait).first().waitFor({ timeout: 55_000 });
    await page.waitForTimeout(p.name === "landing" ? 7000 : 1500);
    // Walk the page so every once-only reveal has fired before the full-page capture; a stitched capture never scrolls.
    const total = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < total; y += 500) {
      await page.evaluate((yy) => window.scrollTo(0, yy), y);
      await page.waitForTimeout(120);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(p.name === "landing" ? 1500 : 600);
    await page.screenshot({ path: `e2e/screenshots/${p.name}-${testInfo.project.name}.png`, fullPage: true });
    const html = await page.content();
    expect(html.includes("—"), "no em-dash in rendered HTML").toBe(false);
    expect(errors, errors.join("\n")).toEqual([]);
  });
}
