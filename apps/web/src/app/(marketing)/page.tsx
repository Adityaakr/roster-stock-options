import type { Metadata } from "next";
import { SiteFooter } from "@/components/site-chrome";
import { SmoothScroll } from "@/components/smooth-scroll";
import { BrandStrip, Counters, Cta, FirstPrint, Hero, Products, Risk, SaidOutLoud, Tiers, WhatThisIsNot, Workflow } from "@/components/landing/sections";
import { Examples } from "@/components/landing/examples";
import { Difference } from "@/components/landing/difference";
import { Weekend } from "@/components/landing/weekend";
import { HoursStrip } from "@/components/landing/hours";
import { RosterProof } from "@/components/landing/ledgers";
import { rosterData } from "@/lib/roster-data";

/*
 * Landing page: the sections of CLAUDE.md 6 in order, on the Aoutive structure, with the live Discover table as the
 * hero's primary element. Every figure comes from rosterData() at request time; the motion catalogue is documented at
 * the top of components/landing/sections.tsx.
 */
export const dynamic = "force-dynamic";

const SOCIAL = "Trade the upside of tokenized stocks on Solana with a fully paid contract. Know your maximum loss before you buy. No borrowing, no funding, no margin calls.";
export const metadata: Metadata = {
  title: { absolute: "Roster Finance. Stock leverage without margin liquidation." },
  description: SOCIAL,
  openGraph: { title: "Roster Finance. Stock leverage without margin liquidation.", description: SOCIAL },
  twitter: { card: "summary_large_image", title: "Roster Finance. Stock leverage without margin liquidation.", description: SOCIAL }
};

export default async function Landing() {
  const d = await rosterData();
  return (
    <div>
      <SmoothScroll />
      <Hero data={d} />
      <BrandStrip />
      <Weekend data={d} />
      <Counters />
      <Tiers data={d} />
      <HoursStrip />
      <Examples data={d} />
      <Products />
      <Workflow data={d} />
      <Difference coverage={`${d.markets.length} listed market${d.markets.length === 1 ? "" : "s"}, ${d.markets.filter((m) => m.tier === 1).length} quoted by the treasury`} />
      <RosterProof data={d} />
      <WhatThisIsNot />
      <FirstPrint />
      <SaidOutLoud />
      <Risk data={d} />
      <Cta />
      <SiteFooter network={d.clusterLabel} source={d.programDeployed ? undefined : "program not deployed, figures are fixtures"} />
    </div>
  );
}
