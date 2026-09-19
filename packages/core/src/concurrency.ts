/**
 * Bounded fan-out. The cranks and the quoter act on one market or one series at a time, and a whole grid can expire on
 * the same Friday: running them one send after another makes a settle backlog take minutes. Every crank is independent
 * and permissionless, so the only ceiling is the RPC's appetite, and a loser simply retries on the next tick.
 */
export async function mapLimit<T>(xs: readonly T[], limit: number, f: (x: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    for (let i = next++; i < xs.length; i = next++) await f(xs[i]!);
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, xs.length)) }, worker));
}

/**
 * A shared ceiling on how much a background job may have in flight at once. `mapLimit` bounds one fan-out; a crank
 * fleet running several of them at once still needs one number, or a person's transaction queues behind the cranks.
 */
export function limiter(n: number): <T>(f: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(f: () => Promise<T>): Promise<T> => {
    if (active >= n) await new Promise<void>((resume) => waiting.push(resume));
    active += 1;
    try {
      return await f();
    } finally {
      active -= 1;
      waiting.shift()?.();
    }
  };
}
