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
    const url = `${HERMES_URL}/v2/updates/price/latest?${missing.map((id) => `ids[]=${id}`).join("&")}&encoding=base64`;
    const res = await fetch(url, { headers: { authorization: `Bearer ${this.apiKey}` }, signal: AbortSignal.timeout(8_000) });
    if (!res.ok) throw new HermesError(`Hermes ${res.status}`, res.status);
    const j = Latest.parse(await res.json());
    for (const p of j.parsed) {
      const sample: PriceSample = { feedId: p.id, price: Number(p.price.price) * 10 ** p.price.expo, conf: Number(p.price.conf) * 10 ** p.price.expo, publishTime: p.price.publish_time, binary: j.binary.data[0] ?? "" };
      this.cache.set(p.id, { at: Date.now(), sample });
      out.set(p.id, sample);
    }
    return out;
  }
}
