"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CountUp, MountReveal, PixelMask, Reveal, Roll, ScrollColorText, SlideIn, Ticker, WordReveal } from "@/components/motion";
import { DiscoverTable } from "@/components/discover-table";
import { MarketList } from "@/components/market-list";
import type { RosterData, Tier } from "@/lib/model";
import { SOURCES } from "./sources";
import { Sketch } from "./sketches";
import { Sec } from "./sec";

/*
 * The landing page, section by section, on the Aoutive structure Lookthrough ported, carrying Roster's content
 * (CLAUDE.md 6). The motion catalogue is unchanged:
 *   Hero: word reveal headline (0.6 s, 0.05 s per word) and sub (1 s, 0.03 s), buttons at 2.0 s and 2.1 s,
 *         the Discover table at 2.8 s under a 24-cell pixel mask over 3 s.
 *   Brand: caption fades up; the ticker runs at 50 px/s and slows to 40% on hover.
 *   Workflow: headline colours in on scroll; four cards fade up 0.1 s apart; the image swaps with a 0.3 s tween.
 *   Said out loud: accordion left, card right, the open item cycles every 6 s; spring 0.6 s.
 *   Products: the two large cards slide in from the centre (x ±290, spring 300/100); three below fade up in sequence.
 *   Counters: four cells counting up on view, staggered 0.1 s.
 *   First Print: three hairline columns fading up at 0, 0.1, 0.2 s.
 *   FAQ: headline left, boxed accordion right where one item is open at a time (0.3 s linear).
 *   CTA: headline with a line ornament, two buttons, image fading up.
 */

const SPRING = { type: "spring" as const, stiffness: 150, damping: 40, mass: 1 };

const IMG = {
  workflow: ["/frames/trade.png", "/frames/act.png", "/frames/positions.png", "/frames/underwrite.png"],
  rosterBg: "/aoutive/6vPEjmr5mSVqv6nCvhHqm3RCVo.png",
  cta: "/aoutive/6qUQoa6uH77wIPi00YA7UqCKdA.png"
};

/* 1. Hero: the headline, then the market list by executable depth (addendum H) and the deepest market's nearest expiry. */
export function Hero({ data }: { data: RosterData }) {
  return (
    <Sec id="hero" className="hero">
      <div style={{ padding: "80px 0", display: "flex", flexDirection: "column", alignItems: "center", gap: 18 }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 40, overflow: "clip" }}>
          <div style={{ maxWidth: 673, display: "flex", flexDirection: "column", alignItems: "center", gap: 20 }}>
            <WordReveal as="h1" text="Stock leverage without margin liquidation." className="display" delay={0.6} stagger={0.05} style={{ textAlign: "center" }} />
            <WordReveal as="p" text="Trade the upside of tokenized stocks on Solana with a fully paid contract. Choose your expiry, see your premium and break-even, and know your maximum loss before you buy. No borrowing, no funding payments, no margin calls." marks={{ Solana: <Image src="/brands/solana.com.png" alt="" width={16} height={16} className="inline-mark" /> }} className="body" delay={1} stagger={0.03} style={{ textAlign: "center", maxWidth: 635 }} />
          </div>
          <div className="btnrow" style={{ justifyContent: "center", gap: 10 }}>
            <MountReveal delay={2} y={20}><a href="#terms" className="btn primary"><Roll>See the terms</Roll></a></MountReveal>
            <MountReveal delay={2.1} y={20}><a href="#works" className="btn secondary"><span className="play" aria-hidden /><Roll>How it works</Roll></a></MountReveal>
          </div>
        </div>
        <MountReveal delay={2.8} y={60} style={{ width: "100%" }}>
          <PixelMask cols={24} rows={13} duration={3}>
            <div id="terms" className="wc" style={{ border: "1px solid var(--line)", borderRadius: 4, textAlign: "left" }}>
              <div className="flex items-center justify-between gap-3 flex-wrap" style={{ marginBottom: 14 }}>
                <div>
                  <div className="h6">Listed markets by executable depth</div>
                  <div className="small" style={{ marginTop: 4 }}>{data.markets.length} listed · best ask, recent volatility and basis per name · pick a name to see its terms</div>
                </div>
                <Link href="/markets" className="btn secondary"><Roll>All markets</Roll></Link>
              </div>
              <MarketList markets={data.markets} compact />
              <div className="flex items-center justify-between gap-3 flex-wrap" style={{ margin: "24px 0 14px" }}>
                <div>
                  <div className="h6">Live terms on {data.underlying.symbol}, nearest expiry</div>
                  <div className="small" style={{ marginTop: 4 }}>{data.underlying.name} · wrapper tier <span className="mono">{data.underlying.wrapperTier}</span> · pick a row to see the payoff and buy</div>
                </div>
                <Link href={`/markets/${data.underlying.symbol}`} className="btn secondary"><Roll>All expiries</Roll></Link>
              </div>
              <DiscoverTable data={data} compact />
            </div>
          </PixelMask>
        </MountReveal>
      </div>
    </Sec>
  );
}

/* 2. Brand strip: what the venue is built on and priced with. */
export function BrandStrip() {
  // Each mark is the site's own icon, fetched once into public/brands; nothing here is drawn by us.
  const names: [string, string, string][] = [["Pyth", SOURCES.pythHermes, "pyth.network"], ["xStocks", SOURCES.xstocksMultipliers, "xstocks.fi"], ["Solana", "https://solana.com", "solana.com"], ["Jupiter", "https://jup.ag", "jup.ag"], ["PreStocks", SOURCES.prestocksApi, "prestocks.com"], ["Surfpool", SOURCES.surfpool, "surfpool.run"], ["tokens.xyz", SOURCES.tokensApi, "tokens.xyz"]];
  return (
    <Sec id="brands" className="brands" ticks={false}>
      <div style={{ padding: "66px 0", display: "flex", flexDirection: "column", alignItems: "center", gap: 40, overflow: "hidden", position: "relative" }}>
        <Reveal y={15} style={{ width: "100%" }}><p className="body" style={{ margin: 0, textAlign: "left", color: "var(--ink-2)" }}>Built on and priced with</p></Reveal>
        <div className="brandbg" aria-hidden />
        <div className="brandwrap">
          <Ticker velocity={50} hoverModifier={40} gap={48}>
            {names.map(([n, href, icon]) => (
              <a key={n} href={href} target="_blank" rel="noreferrer" className="brand">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/brands/${icon}.png`} alt="" width={22} height={22} className="brand-mark" />
                {n}
              </a>
            ))}
          </Ticker>
        </div>
      </div>
    </Sec>
  );
}

/* 3. Workflow: discover, act, manage, commit, with the product screens swapping on the right. */
export function Workflow() {
  const [i, setI] = useState(0);
  const reduce = useReducedMotion();
  const steps = [
    { t: "Discover", d: "Every listed market by executable depth, then every live term on the one you pick: expiry, premium, break-even and the max loss at your size. No wallet needed." },
    { t: "Act", d: "Drag the payoff slider, see the executable quote at your size and the escrow that backs it, sign once." },
    { t: "Manage", d: "What you own, what it is worth now, how long until expiry, and exactly what exercising requires. Exercise any time." },
    { t: "Commit", d: "Get paid to take the other side. Lock USDC or the token, collect the premium, keep it or get assigned at the strike." }
  ];

  return (
    <Sec id="works" className="works">
      <div className="two" style={{ display: "grid", gridTemplateColumns: "minmax(0, 586px) minmax(0, 512px)", justifyContent: "space-between", gap: 90, padding: "80px 30px", alignItems: "center" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 70 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <ScrollColorText as="h2" text="Discover, act, manage. Then commit." className="h-section" style={{ maxWidth: 526 }} />
            <Reveal y={20} delay={0.1}><p className="body" style={{ margin: 0, maxWidth: 586 }}>Every screen does one job. The buyer understands the bet before the instrument: cost, break-even and the worst case are on the table before the wallet is. After the purchase, nobody is left wondering what happens next.</p></Reveal>
          </div>
          <div className="wcards" role="tablist" aria-label="How it works">
            {steps.map((st, j) => (
              <Reveal key={st.t} y={40} delay={j * 0.1}>
                <button role="tab" aria-selected={i === j} className={`wcard ${i === j ? "active" : ""}`} onClick={() => setI(j)}>
                  <div className="t">{st.t}</div>
                  <div className="d">{st.d}</div>
                </button>
              </Reveal>
            ))}
          </div>
        </div>
        <div className="wimages">
          <AnimatePresence initial={false} mode="wait">
            <motion.div key={i} initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3, ease: "linear" }} style={{ position: "relative" }}>
              <Image src={IMG.workflow[i] ?? IMG.workflow[0]!} alt={steps[i]?.t ?? ""} width={1040} height={780} unoptimized className="wshot" style={{ width: "100%", objectFit: "contain", objectPosition: "top left", background: "var(--paper)", display: "block" }} />
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
      <style>{`@media (max-width: 809px) { .works .two { grid-template-columns: minmax(0, 1fr) !important; gap: 40px !important; padding: 56px 18px !important; } }`}</style>
    </Sec>
  );
}

/* 4. Products: what we sell, by product. Two large cards slide in from the centre, three below fade up. */
export function Products() {
  const cards = [
    { t: "Upside", d: "Leveraged upside with the loss capped at the premium. The right to buy a tokenized stock at a strike through an expiry. If it does not get there, you lost the premium and nothing else.", kind: "gap" as const, big: true },
    { t: "Floor", d: "A funded exit at a price you choose, exercisable any time until expiry. The USDC is locked before you buy. No equity venue sells a Saturday exit on Nvidia; this one does.", kind: "floor" as const, big: true },
    { t: "Commit", d: "Get paid to buy a stock cheaper or to sell it higher. Capital is locked until expiry or exercise. Paid risk, disclosed as such, never yield.", kind: "commit" as const, big: false },
    { t: "Protected Buy", d: "Buy the token, or buy it with a floor through a date, in one transaction. Purchase cost, premium and protected proceeds shown together. Ships after Upside and Floor.", kind: "protected" as const, big: false },
    { t: "First Print", d: "Upsides and Floors on PreStocks tokens, the stocks that have not listed yet. Priced off where the token trades, the mint's fee stated in numbers, the issuer's own terms on every ticket.", kind: "firstprint" as const, big: false }
  ];
  return (
    <Sec id="products" className="usecases-sec">
      <div style={{ padding: "80px 30px", display: "flex", flexDirection: "column", alignItems: "center", gap: 96 }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, width: "100%" }}>
          <Reveal y={18} style={{ width: "100%" }}><p className="body" style={{ margin: 0, textAlign: "center", color: "var(--ink-2)" }}>What we sell</p></Reveal>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20 }}>
            <ScrollColorText as="h2" text="Leverage or an exit, with a known worst case." className="h-section" style={{ maxWidth: 801, textAlign: "center" }} />
            <Reveal y={18} delay={0.2}><p className="body" style={{ margin: 0, maxWidth: 658, textAlign: "center" }}>Underneath, fully collateralized contracts on tokenized stocks and pre-IPO tokens, physically settled in the token. On the button, one benefit: priced and funded before you click.</p></Reveal>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14, width: "100%" }}>
          <div className="ucrow">
            {cards.filter((c) => c.big).map((c, j) => (
              <SlideIn key={c.t} x={j === 0 ? 290 : -290}>
                <div className="ucard big">
                  <div className="img"><Sketch kind={c.kind} /></div>
                  <div className="t">{c.t}</div>
                  <div className="d">{c.d}</div>
                </div>
              </SlideIn>
            ))}
          </div>
          <div className="ucrow three">
            {cards.filter((c) => !c.big).map((c, j) => (
              <Reveal key={c.t} y={40} delay={0.2 + j * 0.1} className="ucard">
                <div className="img"><Sketch kind={c.kind} /></div>
                <div className="t">{c.t}</div>
                <div className="d">{c.d}</div>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </Sec>
  );
}

/* 5. Counters: the hours, measured. */
export function Counters() {
  const items: [string, string][] = [
    ["168", "hours a week tokenized stocks trade"],
    ["32.5", "hours a week the shares behind them trade, about 19% of the week"],
    ["75", "hours between Friday's close and Monday's open with no share price"],
    ["63%", "of tokenized-equity spot volume on Solana in 2026 outside US exchange hours"]
  ];
  return (
    <Sec id="hours" className="integration" ticks={false}>
      <div className="ibox">
        <div style={{ padding: "80px 0", display: "flex", justifyContent: "center" }}>
          <ScrollColorText as="h2" text="The hours nobody is watching." className="h-section" style={{ textAlign: "center" }} />
        </div>
        <div className="counters">
          {items.map(([v, t], j) => (
            <Reveal key={t} y={26} delay={j * 0.1} className="counter">
              <div className="v"><CountUp value={v} /></div>
              <div className="t">{t}</div>
              <span className="tick bl" aria-hidden /><span className="tick br" aria-hidden />
            </Reveal>
          ))}
        </div>
      </div>
    </Sec>
  );
}

/* 5b. Every stock, honestly tiered (addendum H): the three liquidity tiers, the live count in each, and the promotion rule. */
export function Tiers({ data }: { data: RosterData }) {
  const count = (t: Tier) => data.markets.filter((m) => m.tier === t).length;
  const items: { tier: Tier; title: string; who: string; what: string }[] = [
    { tier: 1, title: "Tier 1", who: "The launch set", what: "The treasury quotes every expiry, both sides, at three sizes." },
    { tier: 2, title: "Tier 2", who: "Quoted at the front", what: "The treasury quotes the nearest expiry and pre-creates the next as it approaches." },
    { tier: 3, title: "Tier 3", who: "Listed, open to makers", what: "Tradable the moment someone quotes it; the treasury holds no capital there." }
  ];
  return (
    <Sec id="tiers" className="integration" ticks={false}>
      <div className="ibox">
        <div style={{ padding: "80px 18px 40px", display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
          <ScrollColorText as="h2" text="Every stock, honestly tiered." className="h-section" style={{ textAlign: "center" }} />
          <Reveal y={18} delay={0.1}><p className="body" style={{ margin: 0, maxWidth: 640, textAlign: "center" }}>Every tokenized stock that can be escrowed safely is listed. Where our capital quotes is a published rule, not a promise, and a market moves up a tier by filling, not by asking.</p></Reveal>
        </div>
        <div className="tiers">
          {items.map((it, j) => (
            <Reveal key={it.tier} y={26} delay={j * 0.1} className="tier">
              <div className="tier-head">
                <span className="tier-name">{it.title}</span>
                <span className="tier-count"><CountUp value={String(count(it.tier))} /> <span className="tier-unit">market{count(it.tier) === 1 ? "" : "s"}</span></span>
              </div>
              <div className="tier-who">{it.who}</div>
              <p className="tier-what">{it.what}</p>
            </Reveal>
          ))}
        </div>
        <Reveal y={12} delay={0.3}>
          <div className="tier-rule"><b>Promotion rule.</b> A market moves up a tier when its executable depth at the standard size stays above the published threshold for seven consecutive days. Demotion is the same rule in reverse. Every tier&apos;s depth is on the roster, live.</div>
        </Reveal>
      </div>
    </Sec>
  );
}

/* 6. Said out loud: the sources, cycling every 6 s. Dated, linked where the link is verified. */
const SAID: { t: string; date: string; d: string; interp: boolean; links: { href: string | null; label: string }[] }[] = [
  { t: "CoinGecko", date: "September 2026", d: "Perpetuals on tokenized equities did $376.3B against $7.5B of spot. The demand is for leverage; the instrument for it is the one that can't liquidate you.", interp: false, links: [{ href: SOURCES.coingecko, label: "CoinGecko research" }] },
  { t: "Decentralised.co", date: "September 2026", d: "63% of tokenized-equity spot volume on Solana in 2026 happened outside US exchange hours. Their case for concentrating options liquidity on one asset concerned SOL; applying it to NVDAx is our interpretation.", interp: true, links: [{ href: SOURCES.decentralised, label: "Decentralised.co" }] },
  { t: "The Block", date: "May 2026", d: "A $200M pre-IPO position hedged against $3M of open interest. The exit market for private-company tokens is a rounding error next to the positions that need one.", interp: false, links: [{ href: SOURCES.theblock, label: "The Block" }] },
  { t: "Pantera", date: "June 2026", d: "Equity-based tokenized startups out-trading perps. The demand for the underlying is there; the instruments around it are not.", interp: false, links: [{ href: SOURCES.pantera, label: "Pantera Capital" }] },
  { t: "Pyth", date: "February 2026", d: "Synthetic overnight pricing produced liquidations at untradeable prices. A mark the market never printed is still a mark a perp will liquidate on.", interp: false, links: [{ href: SOURCES.pythMarketHours, label: "Pyth market hours" }] },
  { t: "Alpaca", date: "Order types", d: "A limit order controls the price of a fill but not whether it fills. A funded exit is a counterparty who has already locked the cash.", interp: false, links: [{ href: SOURCES.alpaca, label: "Alpaca docs" }] }
];

export function SaidOutLoud() {
  const [open, setOpen] = useState(0);
  const [paused, setPaused] = useState(false);
  const reduce = useReducedMotion();
  useEffect(() => {
    if (paused || reduce) return;
    const t = setInterval(() => setOpen((o) => (o + 1) % SAID.length), 6000);
    return () => clearInterval(t);
  }, [paused, reduce]);
  const e = SAID[open]!;
  return (
    <Sec id="said" className="automation" ticks={false}>
      <div style={{ padding: "80px 0", display: "flex", flexDirection: "column", gap: 50 }}>
        <div style={{ padding: "0 30px", display: "flex", flexDirection: "column", gap: 20 }}>
          <ScrollColorText as="h2" text="Said out loud, by people who measured it." className="h-section" style={{ maxWidth: 896 }} />
          <Reveal y={0} delay={0.2}><p className="body" style={{ margin: 0, maxWidth: 796 }}>Every figure on this page has a date and a source. Where a source&apos;s point concerned a different asset, the line says so.</p></Reveal>
        </div>
        <Reveal y={48}>
          <div className="atab" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
            <div className="acards">
              {SAID.map((c, j) => (
                <div key={c.t} className={`acard ${open === j ? "active" : ""}`}>
                  <button aria-expanded={open === j} onClick={() => { setOpen(j); setPaused(true); }}>{c.t}</button>
                  <AnimatePresence initial={false}>
                    {open === j ? (
                      <motion.p key="body" initial={reduce ? false : { height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.6, ease: [0.2, 0, 0, 1] }}>{c.date}</motion.p>
                    ) : null}
                  </AnimatePresence>
                </div>
              ))}
            </div>
            <div className="aimage">
              <AnimatePresence initial={false} mode="wait">
                <motion.div key={open} initial={reduce ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ ...SPRING, duration: 0.6 }} className="evcard">
                  <div className="mono note">{e.date}</div>
                  <p className="evq">{e.d}</p>
                  <div className="evrow">
                    <span><i className="yes">✓</i>dated</span>
                    <span><i className={e.links[0]?.href ? "yes" : "no"}>{e.links[0]?.href ? "✓" : "–"}</i>{e.links[0]?.href ? "source linked" : "link pending verification"}</span>
                    <span><i className={e.interp ? "no" : "yes"}>{e.interp ? "–" : "✓"}</i>{e.interp ? "our interpretation" : "applies as stated"}</span>
                  </div>
                  <div className="btnrow" style={{ marginTop: 18 }}>
                    {e.links.map((l) => l.href ? <a key={l.label} className="navlink" href={l.href} target="_blank" rel="noreferrer">{l.label}</a> : <span key={l.label} className="muted small">{l.label}</span>)}
                  </div>
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </Reveal>
      </div>
    </Sec>
  );
}

/* 7. First Print: three hairline columns, one per PreStocks token, with the issuer's live figures. */
export function FirstPrint() {
  const [live, setLive] = useState<Record<string, { tokenPrice: number | null; markPrice: number | null; spreadPct: number | null; listed: boolean }>>({});
  useEffect(() => {
    fetch("/api/preipo", { cache: "no-store" }).then((r) => r.json()).then((j: { tokens: { symbol: string; tokenPrice: number | null; markPrice: number | null; spreadPct: number | null; market: unknown }[] }) => {
      const m: typeof live = {};
      for (const t of j.tokens ?? []) m[t.symbol] = { tokenPrice: t.tokenPrice, markPrice: t.markPrice, spreadPct: t.spreadPct, listed: !!t.market };
      setLive(m);
    }).catch(() => undefined);
  }, []);
  const fmt = (v: number | null) => (v === null ? "…" : `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  const spread = (s: string) => { const v = live[s]?.spreadPct ?? null; return v === null ? "…" : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}% ${v >= 0 ? "above" : "below"} the mark`; };
  const tokens = [
    { t: "OPENAI", d: "The largest private name on chain. The token trades at a premium to the issuer's mark, the price of access; an Upside is that upside with the loss capped, a Floor is an exit at a price you chose.", sym: "OPENAI", cta: "A known price on OPENAI", items: ["Priced off where the token trades, never the mark", "Both figures on every ticket, the spread named", "Exercisable any time until expiry", "The mint's transfer fee stated in numbers", "No ownership, voting or dividend rights"] },
    { t: "SPACEX", d: "The largest float of the eight. The token has traded below the issuer's mark for the lack of an exit before a listing; a Floor is the exit that already has the USDC locked.", sym: "SPACEX", cta: "A funded exit on SPACEX", items: ["USDC locked before you buy", "Sell at the strike any time through the date", "Settles in the token itself, no oracle", "Fee delivered on top so writers are paid to the unit", "IPO and deal terms from the issuer on the ticket"], primary: true },
    { t: "NEURALINK", d: "The widest premium of the eight. Holders can be paid to sell it higher through a Covered Call vault, and buyers can hold the upside without holding the token.", sym: "NEURALINK", cta: "Every PreStocks token", items: ["Eight tokens from the issuer's API, live", "Implied valuation both ways", "Recent volatility measured, not assumed", "Listed as escrow is proven, tier by tier", "Paid risk, disclosed as such, never yield"] }
  ].map((p) => ({ ...p, price: fmt(live[p.sym]?.tokenPrice ?? null), unit: "token", sub: spread(p.sym), href: live[p.sym]?.listed ? `/pre-ipo/${p.sym}` : "/pre-ipo" }));
  return (
    <Sec id="first-print" className="plans-sec">
      <div style={{ padding: "100px 0 0", display: "flex", flexDirection: "column", gap: 75 }}>
        <div className="two" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, padding: "0 30px" }}>
          <ScrollColorText as="h2" text="The stocks that have not listed yet." className="h-section" style={{ maxWidth: 500 }} />
          <Reveal y={18} delay={0.1}><p className="body" style={{ margin: 0, maxWidth: 392 }}>PreStocks tokens trade on chain before the company does, above or below the issuer&apos;s mark for months with no print to anchor them. A funded price on a date is the only way to know what you will get.</p></Reveal>
        </div>
        <div className="plans">
          {tokens.map((p, j) => (
            <Reveal key={p.t} y={48} delay={j * 0.1} className="plan">
              <div className="head">
                <div className="flex items-center justify-between gap-3"><div className="t">{p.t}</div><span className="ptag">PreStocks</span></div>
                <div className="d">{p.d}</div>
              </div>
              <div className="mid">
                <div className="price mono">{p.price}<small>/ {p.unit}</small></div>
                <div className="d" style={{ marginTop: 0 }}>{p.sub}</div>
                <Link href={p.href} className={`btn ${p.primary ? "primary" : "secondary"} wide`}><Roll>{p.cta}</Roll><span className="arrow" aria-hidden>→</span></Link>
              </div>
              <div className="list">
                <div className="t" style={{ fontSize: 18 }}>What the ticket says:</div>
                <ul>{p.items.map((it) => <li key={it}><i>✓</i>{it}</li>)}</ul>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </Sec>
  );
}

/* 8. What this is not. */
const QA: [string, string][] = [
  ["This is an options protocol.", "Mechanically these are fully collateralized American options, and the docs say so. What we sell is one benefit: leverage or an exit with a known worst case, priced and funded before you click. No chain of strikes, no greeks, one underlying."],
  ["Options venues on Solana die of fragmentation.", "They listed dozens of assets across dozens of strikes and expiries and split every maker across hundreds of thin books. We list every eligible market and concentrate capital on a launch set, publish the depth of each name, and cap live series per market so the book cannot sprawl. Several makers compete for the same term."],
  ["Why not a perp?", "A perp is the right tool for funding-rate exposure. It is the wrong tool for a position you want to leave on over a weekend on an asset whose market is closed. We point at perps for the first case."],
  ["Why not a limit order?", "A limit order controls the price of a fill but can sit unfilled through the exact hours you needed it. A funded exit is a counterparty who has already locked the cash."],
  ["Nothing will fill.", "The sell side is seeded by the treasury's own capital and a maker bot from day one, and the roster page shows exactly what is fillable at what size. The treasury is a market maker, not a yield product: it can lose money in a week where the market gaps through its strikes, and its results are published, losing weeks included."]
];

export function WhatThisIsNot() {
  const [open, setOpen] = useState(0);
  const reduce = useReducedMotion();
  return (
    <Sec id="questions" className="faq-sec" ticks={false}>
      <div className="two" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, padding: "100px 30px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 388 }}>
          <ScrollColorText as="h2" text="What this is not" className="h-section" />
          <Reveal y={18} delay={0.1}><p className="body" style={{ margin: 0 }}>The objections we expect, answered before they are raised. Never a claim to have invented a derivative.</p></Reveal>
        </div>
        <Reveal y={40} delay={0.3} style={{ width: "100%", maxWidth: 660 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {QA.map(([q, a], j) => (
              <div key={q} className={`fcard ${open === j ? "open" : ""}`}>
                <button aria-expanded={open === j} onClick={() => setOpen(open === j ? -1 : j)}>
                  <span>&ldquo;{q}&rdquo;</span>
                  <span className="pm" aria-hidden>{open === j ? "−" : "+"}</span>
                </button>
                <AnimatePresence initial={false}>
                  {open === j ? (
                    <motion.p key="a" initial={reduce ? false : { height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: "linear" }}>{a}</motion.p>
                  ) : null}
                </AnimatePresence>
              </div>
            ))}
          </div>
        </Reveal>
      </div>
    </Sec>
  );
}


/* 10. CTA */
export function Cta() {
  return (
    <Sec id="cta" className="cta-sec">
      <div className="ctabox">
        <div className="ctatext">
          <svg className="ctaline" viewBox="0 0 768 95" aria-hidden><path d="M0 94.5H768" stroke="var(--line)" /><path d="M120 94.5 120 40 M 380 94.5 380 20 M 640 94.5 640 60" stroke="var(--line)" /></svg>
          <div style={{ display: "flex", flexDirection: "column", gap: 40, padding: "0 0 0 30px", maxWidth: 492 }}>
            <ScrollColorText as="h2" text="Known worst case. Funded before you click." className="h-section" style={{ maxWidth: 500 }} />
            <div className="btnrow" style={{ gap: 16 }}>
              <Reveal y={20}><a href="#terms" className="btn primary"><Roll>See the terms</Roll></a></Reveal>
              <Reveal y={20} delay={0.1}><Link href="/roster" className="btn secondary"><Roll>Check the roster</Roll></Link></Reveal>
            </div>
          </div>
        </div>
        <div className="ctaimg">
          <Reveal y={40}><Image src={IMG.cta} alt="" width={548} height={330} unoptimized style={{ width: "100%", height: "auto", display: "block" }} /></Reveal>
        </div>
      </div>
    </Sec>
  );
}

export { IMG };
