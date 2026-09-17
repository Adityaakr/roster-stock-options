/*
 * The single Hermes client (Part 2 section 4): Core endpoint with the Bearer key, short-TTL cache, rate-limit aware.
 * Nothing else in the repo calls Hermes. Feed ids come from docs/FEEDS.md through the market registry, never here.
 */
import { z } from "zod";

export const HERMES_URL = process.env.PYTH_HERMES_URL ?? "https://pyth.dourolabs.app/hermes";

const Parsed = z.object({
  id: z.string(),
  price: z.object({ price: z.string(), conf: z.string(), expo: z.number(), publish_time: z.number() }),
  ema_price: z.object({ price: z.string(), conf: z.string(), expo: z.number(), publish_time: z.number() }).optional()
});
const Latest = z.object({ binary: z.object({ encoding: z.string(), data: z.array(z.string()) }), parsed: z.array(Parsed) });

export interface PriceSample {
  feedId: string;
  /** USD per unit, as a float for display and the quoter; the crank uses the binary update on-chain. */
  price: number;
  conf: number;
  publishTime: number;
  /** The base64 update payload for `post_update_atomic`. */
  binary: string;
}

export class HermesError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

export class Hermes {
  private cache = new Map<string, { at: number; sample: PriceSample }>();
  private lastCall = 0;
  /** Feeds the key's grant refused, with Hermes' own words, kept ten minutes so a refused feed is not re-asked every tick. */
  readonly denied = new Map<string, { at: number; why: string }>();

  /** The grant's refusal for a feed, if Hermes refused it recently. */
  entitlementError(feedId: string): string | null {
    const d = this.denied.get(feedId);
    return d && Date.now() - d.at < 600_000 ? d.why : null;
  }

  /** No feed of the request could be served: surface the refusal so the caller can name the blocker. */
  private throwIfNothing(feedIds: string[], out: Map<string, PriceSample>, err?: Error): void {
    if (feedIds.some((id) => out.has(id))) return;
    const why = feedIds.map((id) => this.entitlementError(id)).find(Boolean);
    if (why) throw new HermesError(`Hermes 403: ${why}`, 403);
    if (err) throw err;
  }

  constructor(private readonly apiKey: string | undefined, private readonly ttlMs = 2_000, private readonly minGapMs = 350) {}

  get keyed(): boolean {
    return !!this.apiKey;
  }

  /** Latest prices for the given hex feed ids. Throws HermesError(401) without a key: the caller decides what that blocks. */
  async latest(feedIds: string[]): Promise<Map<string, PriceSample>> {
    const out = new Map<string, PriceSample>();
    const now = Date.now();
    const missing = feedIds.filter((id) => {
      const c = this.cache.get(id);
      if (c && now - c.at < this.ttlMs) {
        out.set(id, c.sample);
        return false;
      }
      return true;
    });
    if (missing.length === 0) return out;
    if (!this.apiKey) throw new HermesError("PYTH_CORE_API_KEY missing: Hermes price reads need a key (docs/OPERATOR.md)", 401);
    const wait = this.minGapMs - (now - this.lastCall);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastCall = Date.now();
    // One request for the batch; if the key's grant excludes any feed the whole batch is refused (403), so the
    // feeds are then asked for one by one and the refused ones are remembered for ten minutes. What the plan
    // covers is used; what it does not is reported by `entitlementError`.
    const ask = async (ids: string[]) => {
      const url = `${HERMES_URL}/v2/updates/price/latest?${ids.map((id) => `ids[]=${id}`).join("&")}&encoding=base64`;
      const res = await fetch(url, { headers: { authorization: `Bearer ${this.apiKey}` }, signal: AbortSignal.timeout(8_000) });
      if (!res.ok) throw new HermesError(`Hermes ${res.status}${res.status === 403 ? `: ${(await res.text()).slice(0, 160)}` : ""}`, res.status);
      const j = Latest.parse(await res.json());
      for (const p of j.parsed) {
        const sample: PriceSample = { feedId: p.id, price: Number(p.price.price) * 10 ** p.price.expo, conf: Number(p.price.conf) * 10 ** p.price.expo, publishTime: p.price.publish_time, binary: j.binary.data[0] ?? "" };
        this.cache.set(p.id, { at: Date.now(), sample });
        out.set(p.id, sample);
      }
    };
    const askable = missing.filter((id) => { const d = this.denied.get(id); return !(d && Date.now() - d.at < 600_000); });
    if (askable.length === 0) { this.throwIfNothing(feedIds, out); return out; }
    try {
      await ask(askable);
    } catch (e) {
      if (!(e instanceof HermesError) || e.status !== 403 || askable.length === 1) {
        if (e instanceof HermesError && e.status === 403) this.denied.set(askable[0]!, { at: Date.now(), why: e.message.replace(/^Hermes 403: /, "") });
        this.throwIfNothing(feedIds, out, e as Error);
        return out;
      }
      for (const id of askable) {
        try { await ask([id]); } catch (one) {
          if (one instanceof HermesError && one.status === 403) this.denied.set(id, { at: Date.now(), why: one.message.replace(/^Hermes 403: /, "") });
          else throw one;
        }
      }
    }
    this.throwIfNothing(feedIds, out);
    return out;
  }
}
