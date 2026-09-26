/*
 * One RPC endpoint with fallbacks. A hosted key runs out (a monthly cap, a rate limit) and the venue must not go dark
 * with it: every read and send goes to the first endpoint, and a refusal that names capacity or rate (429) or a server
 * failure (5xx) is retried against the next, in order. The public cluster endpoint is the last resort: it allows
 * roughly a hundred requests every ten seconds from one address, so calls to it are paced and a 429 from it is
 * waited out rather than passed on. Slower, never dark.
 */
const PUBLIC: Record<string, string> = { devnet: "https://api.devnet.solana.com", mainnet: "https://api.mainnet-beta.solana.com" };

export function rpcEndpoints(primary: string, cluster: string | null): string[] {
  const extra = (process.env.RPC_FALLBACK_URLS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const pub = cluster && PUBLIC[cluster] ? [PUBLIC[cluster]!] : [];
  return [...new Set([primary, ...extra, ...pub])];
}

const isPublic = (url: string) => Object.values(PUBLIC).some((p) => url.startsWith(p));

/** Whether reads are currently going to a public, paced endpoint: loops that can wait (history backfill) should. */
export const rpcState = { degraded: false };

/** A pace of `perSecond` calls: each caller waits for its slot, so a burst from many loops becomes a steady stream. */
function pacer(perSecond: number): () => Promise<void> {
  const gap = 1000 / perSecond;
  let next = 0;
  return () => {
    const now = Date.now();
    const at = Math.max(now, next);
    next = at + gap;
    return at > now ? new Promise((r) => setTimeout(r, at - now)) : Promise.resolve();
  };
}

/** A fetch for `@solana/web3.js`'s Connection that fails over across `urls`; the URL web3 passes is ignored. */
export function failoverFetch(urls: string[], timeoutMs = 15_000): (url: string | URL | Request, init?: RequestInit) => Promise<Response> {
  let preferred = 0;
  let preferredSince = 0;
  const warned = new Set<number>();
  const pace = urls.map((u) => (isPublic(u) ? pacer(8) : null));
  const name = (u: string) => u.replace(/\?.*$/, "").slice(0, 48);
  return async (_url, init) => {
    // A fallback is a detour, not a new home: after thirty seconds the primary gets another chance.
    if (preferred !== 0 && Date.now() - preferredSince > 30_000) preferred = 0;
    let last: Response | null = null;
    let lastErr: unknown = null;
    for (let i = 0; i < urls.length; i++) {
      const at = (preferred + i) % urls.length;
      const url = urls[at]!;
      // Three attempts on every endpoint: a keyed endpoint's 429 is a burst limit that clears in well under a second,
      // so a short wait there beats a detour to the throttled public endpoint. The public one waits longer.
      const attempts = 3;
      for (let n = 0; n < attempts; n++) {
        try {
          await pace[at]?.();
          const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
          if (res.status === 429 || res.status >= 500) {
            last = res;
            if (n < attempts - 1) { await new Promise((r) => setTimeout(r, pace[at] ? 1500 * (n + 1) : 250 * (n + 1) + Math.random() * 200)); continue; }
            if (!warned.has(at)) { warned.add(at); console.warn(`[rpc] ${name(url)} answered ${res.status}; trying the next endpoint`); }
            break;
          }
          if (at !== preferred) { console.warn(`[rpc] now preferring ${name(url)}`); preferred = at; preferredSince = Date.now(); }
          rpcState.degraded = !!pace[at];
          return res;
        } catch (e) {
          lastErr = e;
          break;
        }
      }
    }
    if (last) return last;
    throw lastErr instanceof Error ? lastErr : new Error("every RPC endpoint failed");
  };
}
