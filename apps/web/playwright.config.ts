import { defineConfig, devices } from "@playwright/test";

/** Screenshots at 1280 and 390, as the build contract asks, against a running dev server or PLAYWRIGHT_BASE_URL. */
export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    screenshot: "only-on-failure"
  },
  projects: [
    { name: "frames", testMatch: /frames\.spec\.ts/, use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 } },
    { name: "1280", testMatch: /shots\.spec\.ts/, dependencies: ["frames"], use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } } },
    { name: "390", testMatch: /shots\.spec\.ts/, dependencies: ["frames"], use: { ...devices["iPhone 12"], viewport: { width: 390, height: 844 } } },
    // The M4 flow on the fork: burner wallet, buy, write, exercise, release. Skips itself when the fork or the services are down.
    { name: "flow", testMatch: /(flow|protected-buy)\.spec\.ts/, use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } } },
    // The same journey on devnet, funded by the app's faucet rather than a cheatcode. Skips itself off devnet.
    { name: "devnet", testMatch: /(devnet|modal)\.spec\.ts/, use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } } }
  ]
});
