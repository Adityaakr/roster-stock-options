"use client";

import Link from "next/link";
import { Roll } from "@/components/motion";

/** Marketing nav, as the reference: wordmark left, links centre with the growing underline, primary button right, hairline below. */
export function SiteNav() {
  return (
    <div className="nav">
      <div className="inner">
        <Link href="/" className="wordmark"><i />Roster Finance</Link>
        <nav className="links" aria-label="Site">
          <a className="navlink" href="#problem">The problem</a>
          <a className="navlink" href="#examples">What you can do</a>
          <a className="navlink" href="#different">How it is different</a>
          <a className="navlink" href="#roster">The roster</a>
          <a className="navlink" href="#questions">What this is not</a>
        </nav>
        <Link href="/trade" className="btn primary"><Roll>Open the app</Roll></Link>
      </div>
    </div>
  );
}

export function SiteFooter({ network, source }: { network?: string; source?: string }) {
  return (
    <footer className="footer">
      <div className="inner">
        <div className="cols">
          <div>
            <Link href="/" className="wordmark"><i />Roster Finance</Link>
            <p style={{ maxWidth: 360, marginTop: 14 }}>Stock leverage without margin liquidation, on Solana. Contracts can expire worthless. Nothing here is an offer of any security.</p>
            <p className="mono" style={{ marginTop: 14, fontSize: 12 }}>{network ? <>Cluster {network}</> : null}{source ? <> · {source}</> : null}</p>
          </div>
          <div>
            <h6>Product</h6>
            <ul><li><Link className="navlink" href="/trade">App</Link></li><li><Link className="navlink" href="/positions">Positions</Link></li><li><Link className="navlink" href="/roster">Roster</Link></li><li><Link className="navlink" href="/underwrite">Underwrite</Link></li><li><Link className="navlink" href="/pre-ipo">First Print</Link></li></ul>
          </div>
          <div>
            <h6>Source</h6>
            <ul><li><a className="navlink" href="https://github.com/adityakrx/roster#readme" target="_blank" rel="noreferrer">Docs</a></li><li><a className="navlink" href="https://github.com/adityakrx/roster" target="_blank" rel="noreferrer">Source</a></li><li><a className="navlink" href="#risk">Risk</a></li></ul>
          </div>
          <div>
            <h6>Reading</h6>
            <ul><li><a className="navlink" href="https://docs.xstocks.fi/developers/multipliers" target="_blank" rel="noreferrer">xStocks multipliers</a></li><li><a className="navlink" href="https://docs.pyth.network/price-feeds/market-hours" target="_blank" rel="noreferrer">Pyth market hours</a></li><li><a className="navlink" href="https://docs.tessera.pe/features/redemption" target="_blank" rel="noreferrer">Tessera redemption</a></li></ul>
          </div>
        </div>
        <div className="divider" style={{ margin: "40px 0 20px" }} />
        <div className="flex flex-wrap justify-between gap-3">
          <span>Built for the Solana Stocklana hackathon, September 2026.</span>
          <span>Fully collateralized, American exercise, physical settlement. Non-US wrappers.</span>
        </div>
      </div>
    </footer>
  );
}
