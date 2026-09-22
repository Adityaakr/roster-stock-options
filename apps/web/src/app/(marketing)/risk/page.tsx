import type { Metadata } from "next";
import { DocPage } from "@/components/doc-page";

export const metadata: Metadata = { title: "Risk · Roster Finance", description: "What a Roster contract is, what it protects against, and what it does not." };

/** Risk and honesty (CLAUDE.md 6): what is live, what is not, and what a contract does not protect against. */
export default function RiskPage() {
  return (
    <DocPage title="Risk" lead="Fully collateralized, American exercise, physical settlement. Contracts can expire worthless. This page says what that means before you sign anything." updated="September 22, 2026">
      <h2>What a contract is</h2>
      <p>An Upside is the right to buy a fixed number of tokens at a fixed USDC price until a fixed time. A Floor is the right to sell. Every contract is backed by the full collateral in a program-owned vault from the moment it is sold: the tokens for an Upside, the USDC for a Floor. There is no margin, no borrowing, no funding payment and no liquidation. The most a buyer can lose is the premium plus the fee, paid once at purchase.</p>
      <h2>What is live and what is not</h2>
      <ul>
        <li>Live: Upside and Floor on every listed market, xStocks and PreStocks tokens alike, with both sides quoted; the roster with every reserve by account; exercise and settlement; the Covered Call and Cash-Secured Put vaults with every epoch published; sell-back to a vault at its bid; Earn, the write side. The app&apos;s header names the cluster, and every figure on every screen is read from it.</li>
        <li>Not live: Protected Buy (a swap and a Floor in one transaction), which needs a swap route the current cluster does not carry, and auto-exercise, which needs a verifiable on-chain price; contracts are American, so holders exercise themselves and the app says so. Mainnet deployment is a separate, announced step.</li>
      </ul>
      <h2>What a contract does not protect against</h2>
      <ul>
        <li><b>Chain halts.</b> If Solana stops, nothing can be exercised until it resumes. Expiry is measured by the chain clock.</li>
        <li><b>Token freezes, pauses and transfer restrictions.</b> The issuer of a wrapped stock can pause its mint, freeze an account or hold a permanent delegate that lets it seize tokens. A paused mint halts every series on it: exercise and settlement wait, and the contract&apos;s expiry extends 24 hours past the resume so the halt costs no time. A frozen or seized vault is a loss the contract cannot make good.</li>
        <li><b>Basis.</b> The token can trade away from the share it tracks, especially when the equity market is closed. Strikes are in USDC per token; the share price is context, not the settlement price.</li>
        <li><b>Corporate actions.</b> Strikes are per token. Splits and dividends change the issuer&apos;s multiplier, which changes how many shares a token represents; the contract&apos;s token count and USDC strike do not move.</li>
        <li><b>Counterparty rights in the wrapper.</b> xStocks are tracker certificates with no voting rights. PreStocks tokens confer no ownership, voting, dividend or information rights, and after an IPO must be converted within the issuer&apos;s window or expire worthless.</li>
      </ul>
      <h2>Dividends during an Upside</h2>
      <p>Dividend reinvestment on an xStock accrues to the escrowed tokens through the issuer&apos;s multiplier. It is captured by whoever holds the tokens at exercise: the buyer if they exercise, the writer if the contract expires.</p>
      <h2>Auto-exercise</h2>
      <p>Auto-exercise is opt-in per position. When it is on, a keeper may exercise in the hour before expiry if the position is in the money by more than the keeper fee, using a Pyth price posted in the same transaction. The keeper fee is paid from the protocol&apos;s fee vault, never from the holder. If it is off, an in-the-money contract left unexercised at expiry is worth nothing.</p>
      <h2>Underwriting</h2>
      <p>Writing a contract is paid risk, not yield. If the price moves through the strike you are assigned at it, whatever the market price is then. Assignment is pooled across every writer on a term in proportion to what each sold. Capital is locked until expiry or exercise.</p>
      <h2>Jurisdiction</h2>
      <p>The wrapped stocks listed here are non-US wrappers and are not offered to US persons by their issuers. The app refuses requests from blocked jurisdictions with a plain message. Nothing here is an offer of any security.</p>
    </DocPage>
  );
}
