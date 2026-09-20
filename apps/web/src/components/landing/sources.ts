/*
 * Every link the landing page prints. A URL is here only if it was verified on 2026-09-17 (CLAUDE.md 2); an entry
 * that is null renders as "link pending verification" rather than a guessed address. Fill them in, never invent them.
 */
export const SOURCES = {
  pythHermes: "https://docs.pyth.network/price-feeds/core/how-pyth-works/hermes",
  pythMarketHours: "https://docs.pyth.network/price-feeds/market-hours",
  pythBenchmarks: "https://benchmarks.pyth.network",
  xstocksMultipliers: "https://docs.xstocks.fi/developers/multipliers",
  xstocksAssets: "https://docs.xstocks.fi/apis/openapi/assets",
  prestocksFaq: "https://prestocks.com/faq",
  prestocksApi: "https://prestocks.com/api/prestocks",
  surfpool: "https://docs.surfpool.run",
  tokensApi: "https://docs.tokens.xyz",
  // Cited in CLAUDE.md 6 by publisher and month; the article URLs were not in the brief and are not guessed.
  coingecko: null as string | null,
  decentralised: null as string | null,
  theblock: null as string | null,
  pantera: null as string | null,
  alpaca: null as string | null
};
