import type { Metadata } from "next";
import { DocPage } from "@/components/doc-page";

export const metadata: Metadata = { title: "Fees · Roster Finance", description: "The one fee, where it goes, and what is free." };

/** Fees (CLAUDE.md addendum G): collected once at buy, never at exercise or settlement. */
export default function FeesPage() {
  return (
    <DocPage title="Fees" lead="One taker fee on the premium, collected at purchase. Nothing at exercise, nothing at settlement, so the maximum loss shown before you buy is the true maximum loss." updated="September 17, 2026">
      <h2>Schedule</h2>
      <ul>
        <li><b>Taker fee:</b> 10 basis points of the premium, rounded up to the nearest USDC micro unit, paid by the buyer at <code>buy</code>. The figure on every quote is the program's own <code>fee_bps</code>, read from the protocol account.</li>
        <li><b>Integrator share:</b> 30% of the taker fee when a buy carries a registered referrer. Referrals are not open yet; every fee currently stays with the protocol and the quote says so.</li>
        <li><b>Keeper fee:</b> up to 2 USDC per auto-exercise, paid from the protocol's fee vault to whoever cranks it. Never charged to the holder.</li>
        <li><b>Writers:</b> no fee to quote, cancel, claim premium, withdraw or settle. Writers pay only the network's transaction fee.</li>
        <li><b>Rent:</b> creating a series costs rent for its accounts, paid by whoever creates it and returned when the series closes after expiry.</li>
      </ul>
      <h2>Where fees go</h2>
      <p>Fees sit in a program-owned fee vault per quote mint. Only the protocol authority can withdraw them, and only to the treasury account named in the protocol config. Dust left in a series vault after every writer has settled is swept to the same vault when the series closes.</p>
      <h2>The treasury</h2>
      <p>The treasury quotes Tier 1 and Tier 2 markets as a market maker. It is not a yield product: it can lose money in a week where the market gaps through its strikes, and its performance is published on the roster including losing weeks.</p>
    </DocPage>
  );
}
