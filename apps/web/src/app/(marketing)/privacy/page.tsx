import type { Metadata } from "next";
import { DocPage } from "@/components/doc-page";

export const metadata: Metadata = { title: "Privacy · Roster Finance", description: "What the app records and what it does not." };

export default function PrivacyPage() {
  return (
    <DocPage title="Privacy" lead="The app reads public chain data and asks your wallet to sign. It keeps as little as it can." updated="September 17, 2026">
      <h2>What is recorded</h2>
      <ul>
        <li><b>On-chain data.</b> Every position, quote and exercise is public on Solana. The indexer copies the program&apos;s events into its own database to serve the roster and your positions faster.</li>
        <li><b>Request logs.</b> The web server logs requests with an IP-derived country code for the jurisdiction check, and no more than a standard web server would.</li>
        <li><b>Your browser.</b> Watchlists and the last market you looked at live in your browser&apos;s storage, keyed to your wallet&apos;s public key. They never leave your device.</li>
      </ul>
      <h2>What is not recorded</h2>
      <p>No account, no email, no cookies for tracking, no analytics that identify you. The wallet&apos;s public key is used to read your positions and to build transactions you sign yourself.</p>
      <h2>Third parties</h2>
      <p>Prices come from Pyth, multipliers from the xStocks API, and transactions are sent through the app&apos;s RPC provider. Each sees the requests the app makes on your behalf; none receives your wallet&apos;s private key.</p>
    </DocPage>
  );
}
