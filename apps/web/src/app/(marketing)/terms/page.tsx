import type { Metadata } from "next";
import { DocPage } from "@/components/doc-page";

export const metadata: Metadata = { title: "Terms · Roster Finance", description: "The terms on which the app is offered." };

export default function TermsPage() {
  return (
    <DocPage title="Terms of use" lead="Roster Finance is an interface to an open-source Solana program. Using it means agreeing to these terms." updated="September 17, 2026">
      <h2>What the app is</h2>
      <p>The app builds transactions for the <code>roster_finance</code> program and asks your wallet to sign them. It holds no funds and no keys. Every contract is between the buyer and the writers on a term, settled by the program from vaults the program owns.</p>
      <h2>Eligibility</h2>
      <p>You may not use the app if you are a person or entity to whom the underlying wrapped stocks may not be offered, including US persons for xStocks, or if you are in a jurisdiction the app refuses. You are responsible for knowing whether that applies to you.</p>
      <h2>No advice, no offer</h2>
      <p>Nothing on this site is investment, legal or tax advice, and nothing here is an offer of any security. Premiums, marks and volatilities are shown as the quoter computed them from named sources; they are not predictions.</p>
      <h2>Risk</h2>
      <p>Contracts can expire worthless. Underwriting can lose more than the premium collected. The <a href="/risk">risk page</a> lists what a contract does not protect against, including issuer pauses, freezes and seizures of the underlying token.</p>
      <h2>Software</h2>
      <p>The program and the app are provided as they are. The program has not been audited; its source, tests and the list of what is proven are public. Bugs can lose funds.</p>
      <h2>Changes</h2>
      <p>These terms can change. The date at the top is the version in force.</p>
    </DocPage>
  );
}
