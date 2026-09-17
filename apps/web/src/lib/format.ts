/** Browser-safe formatting helpers. Numbers stay tabular and honest: nothing here rounds beyond what it says. */

/** Dollars with two decimals and thousands separators: 3600 -> "3,600.00". */
export function usd(v: number, digits = 2): string {
  return v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Whole dollars: 3600 -> "3,600". */
export function usd0(v: number): string {
  return Math.round(v).toLocaleString("en-US");
}

/** Dollars at the precision the size deserves: cents for anything under 1,000, whole dollars above. */
export function usdSmart(v: number): string {
  return Math.abs(v) >= 1000 ? usd0(v) : usd(v);
}

/** USDC micro units (6 decimals) as a two-decimal string. */
export function usdc(micro: bigint | string | number): string {
  const v = BigInt(micro);
  const whole = v / 1_000_000n;
  const frac = (v % 1_000_000n).toString().padStart(6, "0").slice(0, 2);
  return `${whole.toLocaleString("en-US")}.${frac}`;
}

export function pct(v: number, digits = 1): string {
  return `${v.toFixed(digits)}%`;
}

export function signed(v: number, digits = 2): string {
  return `${v >= 0 ? "+" : "−"}${usd(Math.abs(v), digits)}`;
}

export function short(pk: string, n = 4): string {
  return pk.length > n * 2 + 1 ? `${pk.slice(0, n)}…${pk.slice(-n)}` : pk;
}

export function slotLabel(slot: number | string | bigint): string {
  return Number(slot).toLocaleString("en-US");
}

export function timeLabel(unix: number): string {
  return new Date(unix * 1000).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC";
}

/** "Fri Sep 19" for an expiry, in New York time since that is the session the strike grid follows. */
export function dayLabel(unix: number): string {
  return new Date(unix * 1000).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/New_York" });
}

/** A countdown in the largest two units: "3d 4h", "4h 12m", "12m". */
export function countdown(untilUnix: number, nowUnix: number): string {
  const s = Math.max(0, untilUnix - nowUnix);
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
