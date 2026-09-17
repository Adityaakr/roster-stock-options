/*
 * Pre-IPO tokens (CLAUDE.md 2.4, 2.5): Tessera's T-tokens and PreStocks' tokens from the issuers' own registries.
 * Neither has a Pyth feed; the issuer's mark is the price source and the app says so on every ticket.
 */
const TESSERA_API = "https://rest-api.tessera.pe/v1/public/token-details";
const PRESTOCKS_API = "https://prestocks.com/api/prestocks";

export interface PreIpoToken {
  symbol: string;
  name: string;
  issuer: "Tessera" | "PreStocks";
  mint: string;
  /** The issuer's mark for the underlying share equivalent, USD. */
  markPrice: number | null;
  /** The token's own trading price where the issuer publishes one, USD. */
  tokenPrice: number | null;
  holders: number | null;
  sector: string | null;
  logo: string | null;
  external: string | null;
}

export async function tesseraTokens(): Promise<PreIpoToken[]> {
  const res = await fetch(TESSERA_API, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`tessera: HTTP ${res.status}`);
  const j = (await res.json()) as { code: string; name: string; mint: string; markPrice?: number; holders?: number; sector?: string }[];
  return j.map((t) => ({ symbol: t.code, name: t.name, issuer: "Tessera", mint: t.mint, markPrice: t.markPrice ?? null, tokenPrice: null, holders: t.holders ?? null, sector: t.sector ?? null, logo: null, external: "https://docs.tessera.pe/features/redemption" }));
}

export async function prestocksTokens(): Promise<PreIpoToken[]> {
  const res = await fetch(PRESTOCKS_API, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`prestocks: HTTP ${res.status}`);
  const j = (await res.json()) as { symbol: string; name: string; contract_address: string; markPrice?: number; tokenPrice?: number; image?: string; external_url?: string }[];
  return j.map((t) => ({ symbol: t.symbol, name: t.name, issuer: "PreStocks", mint: t.contract_address, markPrice: t.markPrice ?? null, tokenPrice: t.tokenPrice ?? null, holders: null, sector: null, logo: t.image ?? null, external: t.external_url ?? null }));
}

/** The rights profile and exit terms per issuer, the words the app prints on every ticket (CLAUDE.md 6, risk). */
export const PREIPO_RIGHTS: Record<PreIpoToken["issuer"], { what: string; rights: string; exit: string }> = {
  Tessera: {
    what: "Loan participation rights, not securities",
    rights: "No equity, no voting, no dividends",
    exit: "Redemption needs a liquidity event, lock-up expiry, Tessera receiving proceeds and an announced start date, with no time bound; unclaimed proceeds are forfeited after the window and redemption is not automatic."
  },
  PreStocks: {
    what: "SPV exposure to a private company, backed 1:1",
    rights: "No ownership, voting or dividend rights",
    exit: "A DEX where liquidity depends on finding a buyer; the mark-versus-token spread is the price of no exit."
  }
};
