/*
 * US equity session from the New York clock, per Pyth's published market hours (docs.pyth.network/price-feeds/
 * market-hours): regular 09:30 to 16:00 Mon to Fri, pre 04:00 to 09:30, post 16:00 to 20:00, overnight Sunday to
 * Thursday 20:00 to 04:00. NYSE holidays are read from the equity feed's own status by the oracle package, not here.
 */
export type Session = "regular" | "pre" | "post" | "overnight" | "closed";

export function nyParts(unix: number): { weekday: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "numeric", hour12: false }).formatToParts(new Date(unix * 1000));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { weekday, minutes: (Number(get("hour")) % 24) * 60 + Number(get("minute")) };
}

export function sessionAt(unix: number): Session {
  const { weekday, minutes } = nyParts(unix);
  const weekdayTrading = weekday >= 1 && weekday <= 5;
  if (weekdayTrading) {
    if (minutes >= 570 && minutes < 960) return "regular";
    if (minutes >= 240 && minutes < 570) return "pre";
    if (minutes >= 960 && minutes < 1200) return "post";
  }
  if (weekday >= 0 && weekday <= 4 && minutes >= 1200) return "overnight";
  if (weekday >= 1 && weekday <= 5 && minutes < 240) return "overnight";
  return "closed";
}

/** 16:00 New York on the next `n` weekdays matching `weekdays` (default Fridays) strictly after `unix`. */
export function nextExpiries(unix: number, n: number, weekdays: number[] = [5]): number[] {
  const out: number[] = [];
  const start = unix - (unix % 3600);
  for (let h = 1; h < 24 * 30 && out.length < n; h++) {
    const cand = start + h * 3600;
    const p = nyParts(cand);
    if (weekdays.includes(p.weekday) && p.minutes === 960 && cand > unix && !out.includes(cand)) out.push(cand);
  }
  return out;
}
