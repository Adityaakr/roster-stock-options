/*
 * Pre-IPO tokens (CLAUDE.md 2.5): PreStocks' tokens from the issuer's own registry, every field it publishes. No Pyth
 * feed exists; the token price (where the token trades) is the price source, the issuer's mark is shown beside it,
 * and the app says so on every ticket. The rights and exit terms below are PreStocks' own words (prestocks.com/faq,
 * read 2026-09-20), not ours.
 */
const PRESTOCKS_API = "https://prestocks.com/api/prestocks";

export interface PreIpoToken {
  symbol: string;
  name: string;
  issuer: "PreStocks";
  mint: string;
  /** The issuer's mark: the gross price per share of the referenced company, USD. */
  markPrice: number | null;
  /** Where the token trades on chain, USD per token. */
  tokenPrice: number | null;
  /** Company valuation implied by the mark, and by the token price, USD. */
  markValuation: number | null;
  impliedValuation: number | null;
  /** Token supply in display units. */
  supply: number | null;
  holders: number | null;
  sector: string | null;
  description: string | null;
  logo: string | null;
  external: string | null;
}

// The last good answer from the issuer, kept so that one slow or refused request never empties the desk.
let lastGood: { at: number; tokens: PreIpoToken[] } | null = null;

export async function prestocksTokens(): Promise<PreIpoToken[]> {
  if (lastGood && Date.now() - lastGood.at < 30_000) return lastGood.tokens;
  try {
    const tokens = await fetchPrestocks();
    lastGood = { at: Date.now(), tokens };
    return tokens;
  } catch (e) {
    if (lastGood) return lastGood.tokens;
    throw e;
  }
}

async function fetchPrestocks(): Promise<PreIpoToken[]> {
  const res = await fetch(PRESTOCKS_API, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`prestocks: HTTP ${res.status}`);
  const j = (await res.json()) as { symbol: string; name: string; description?: string; image?: string; external_url?: string; contract_address: string; markPrice?: number; markValuation?: number; tokenPrice?: number; impliedValuation?: number; supply?: number }[];
  return j.map((t) => ({
    symbol: t.symbol, name: t.name, issuer: "PreStocks", mint: t.contract_address,
    markPrice: num(t.markPrice), tokenPrice: num(t.tokenPrice), markValuation: num(t.markValuation), impliedValuation: num(t.impliedValuation), supply: num(t.supply),
    holders: null, sector: null, description: t.description?.trim() || null, logo: t.image ?? null, external: t.external_url ?? null
  }));
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

/** Token price against the issuer's mark, in percent, signed: negative when the token trades below the mark. */
export function spreadToMarkPct(t: Pick<PreIpoToken, "markPrice" | "tokenPrice">): number | null {
  return t.markPrice && t.tokenPrice ? ((t.tokenPrice - t.markPrice) / t.markPrice) * 100 : null;
}

/** The rights profile and exit terms, printed on every ticket (CLAUDE.md 6, risk). PreStocks' own terms, paraphrased closely. */
export const PREIPO_RIGHTS: Record<PreIpoToken["issuer"], { what: string; rights: string; exit: string; ipo: string; mna: string }> = {
  PreStocks: {
    what: "Fully backed by holding entities directly or indirectly invested in the company, with third-party attestation reports",
    rights: "No ownership, voting, dividend, information or other legal rights",
    exit: "Sellable on chain at any time on Jupiter and the apps that route through it, even if the company never lists; exit price and speed depend on the liquidity available. The mark is the issuer's gross price per share, not a price anyone pays for the token.",
    ipo: "After an IPO the token converts on chain into the tokenized public stock, with up to 9 months to convert (the shares may sit in a lockup, typically 6 months); after that deadline the tokens expire worthless.",
    mna: "In a cash acquisition net proceeds are distributed pro rata as USDC; in a stock deal the token may convert into the acquirer's tokenized equity if the issuer supports one, with 6 months to convert, after which the tokens expire worthless."
  }
};
