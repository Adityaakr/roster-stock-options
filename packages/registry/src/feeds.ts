/*
 * Pyth feed ids resolved from Hermes' listing endpoint (`GET /v2/price_feeds?query=`), which needs no key on either
 * host (docs/FEEDS.md). A token feed is `Crypto.<SYMBOL>/USD`; the equity reference is `Equity.US.<UNDERLYING>/USD`.
 */
export const HERMES_HOSTS = ["https://pyth.dourolabs.app/hermes", "https://hermes.pyth.network"];

interface FeedJson {
  id: string;
  attributes: { symbol?: string; asset_type?: string; schedule?: string; display_symbol?: string };
}

async function listFeeds(query: string): Promise<FeedJson[]> {
  let lastErr: unknown = null;
  for (const host of HERMES_HOSTS) {
    try {
      const res = await fetch(`${host}/v2/price_feeds?query=${encodeURIComponent(query)}`, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as FeedJson[];
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`hermes price_feeds ${query}: ${(lastErr as Error)?.message ?? "unreachable"}`);
}

export interface ResolvedFeeds {
  tokenFeed: { id: string; symbol: string; schedule: string | null } | null;
  equityFeed: { id: string; symbol: string; schedule: string | null } | null;
}

/** Exact-symbol matches only: `Crypto.NVDAX/USD`, `Equity.US.NVDA/USD`. Anything else is "no feed", never a guess. */
export async function resolveFeeds(tokenSymbol: string, underlyingSymbol: string | null): Promise<ResolvedFeeds> {
  const want = `Crypto.${tokenSymbol.toUpperCase()}/USD`;
  const token = (await listFeeds(tokenSymbol)).find((f) => f.attributes.symbol === want);
  let equity: FeedJson | undefined;
  if (underlyingSymbol) {
    const wantEq = `Equity.US.${underlyingSymbol.toUpperCase()}/USD`;
    equity = (await listFeeds(underlyingSymbol)).find((f) => f.attributes.symbol === wantEq);
  }
  const pick = (f: FeedJson | undefined) => (f ? { id: f.id, symbol: f.attributes.symbol ?? "", schedule: f.attributes.schedule ?? null } : null);
  return { tokenFeed: pick(token), equityFeed: pick(equity) };
}
