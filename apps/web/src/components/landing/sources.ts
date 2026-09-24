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
  // Cited in CLAUDE.md 6 by publisher and month. Each URL below was opened on 2026-09-25 and the quoted figure or
  // sentence found on the page; the one still null was not found at a primary address and stays unlinked.
  coingecko: "https://www.coingecko.com/en/api/reports/tokenized-equities-sep-2026" as string | null,
  decentralised: null as string | null,
  theblock: "https://www.theblock.co/newsletters/the-funding/2026-05-17-spacex-ipo-pre-ipo-perps-crypto-401570" as string | null,
  pantera: "https://panteracapital.com/blockchain-letter/the-always-on-economy/" as string | null,
  alpaca: "https://docs.alpaca.markets/us/docs/orders-at-alpaca" as string | null
};
