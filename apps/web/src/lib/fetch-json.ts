/*
 * One way to read the app's own API from the browser: a timeout on every attempt, a few retries with backoff on a
 * network error, a 5xx or an answer the caller says is not settled yet (the reconnecting roster), and the last good
 * answer kept by the callers so a slow moment never blanks a screen.
 */
export async function fetchJson<T>(url: string, opts: { tries?: number; timeoutMs?: number; settled?: (v: T) => boolean } = {}): Promise<T> {
  const tries = opts.tries ?? 3;
  const timeoutMs = opts.timeoutMs ?? 20_000;
  let lastErr: unknown = null;
  let lastValue: T | undefined;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
      if (r.status >= 500) throw new Error(`HTTP ${r.status}`);
      if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { final: true });
      const v = (await r.json()) as T;
      if (!opts.settled || opts.settled(v)) return v;
      lastValue = v;
    } catch (e) {
      lastErr = e;
      if ((e as { final?: boolean }).final) throw e;
    }
    if (i < tries - 1) await new Promise((res) => setTimeout(res, 700 * 2 ** i));
  }
  if (lastValue !== undefined) return lastValue;
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
