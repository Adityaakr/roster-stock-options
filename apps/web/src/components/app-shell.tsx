"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useSyncExternalStore, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Icon } from "@/components/icons";
import { WalletMenu } from "@/components/wallet-menu";
import { Badge } from "@/components/ui";
import { useCluster } from "@/lib/cluster";

const NAV = [
  { group: "Trade", items: [
    { href: "/ask", label: "Ask", icon: Icon.Spark, match: (p: string) => p.startsWith("/ask") },
    { href: "/markets", label: "Markets", icon: Icon.Grid, match: (p: string) => p.startsWith("/markets") || p.startsWith("/trade") },
    { href: "/positions", label: "Positions", icon: Icon.Wallet, match: (p: string) => p.startsWith("/positions") }
  ] },
  { group: "Supply", items: [
    { href: "/underwrite", label: "Earn", icon: Icon.Coins, match: (p: string) => p.startsWith("/underwrite") },
    { href: "/vaults", label: "Vaults", icon: Icon.Layers, match: (p: string) => p.startsWith("/vaults") },
    { href: "/roster", label: "Roster", icon: Icon.Shield, match: (p: string) => p.startsWith("/roster") }
  ] },
  { group: "Desks", items: [
    { href: "/pre-ipo", label: "PreStocks", icon: Icon.Building, match: (p: string) => p.startsWith("/pre-ipo") },
    // Protected Buy needs a swap route, which a devnet replica does not have: it is live on the fork and on mainnet.
    { href: "/buy", label: "Protected Buy", icon: Icon.Lock, match: (p: string) => p.startsWith("/buy"), soonOn: ["devnet"] }
  ] }
];

const CRUMB: Record<string, string> = { ask: "Ask", markets: "Markets", trade: "Terms", positions: "Positions", underwrite: "Earn", vaults: "Vaults", roster: "Roster", buy: "Protected Buy", "pre-ipo": "PreStocks" };

/** The market the screen is on, from `?m=` or the term id, so the nav keeps it when moving between screens. */
function useMarketParam(pathname: string): string | null {
  const params = useSearchParams();
  const m = params.get("m");
  if (m) return m;
  const term = pathname.match(/^\/trade\/([a-z0-9]+)-(?:call|put)-/);
  if (term) return term[1]!.toUpperCase().replace(/X$/, "x");
  const market = pathname.match(/^\/markets\/([^/]+)/);
  return market ? decodeURIComponent(market[1]!) : null;
}

/** The product shell: sidebar with grouped nav, sticky topbar with crumbs, the cluster read for the deployed check. */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={null}>
      <Shell>{children}</Shell>
    </Suspense>
  );
}

const SIDEBAR_KEY = "roster.sidebar";
const sidebarListeners = new Set<() => void>();
function readSidebar(): boolean {
  try { return localStorage.getItem(SIDEBAR_KEY) === "folded"; } catch { return false; }
}
function writeSidebar(folded: boolean): void {
  try { localStorage.setItem(SIDEBAR_KEY, folded ? "folded" : "open"); } catch { /* storage may be unavailable */ }
  for (const l of sidebarListeners) l();
}
function subscribeSidebar(l: () => void): () => void {
  sidebarListeners.add(l);
  return () => { sidebarListeners.delete(l); };
}

function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const cluster = useCluster();
  const market = useMarketParam(pathname);
  const withMarket = (href: string) => (market && ["/underwrite", "/roster", "/buy"].includes(href) ? `${href}?m=${encodeURIComponent(market)}` : href);
  const first = pathname.split("/")[1] ?? "";
  const reduce = useReducedMotion();
  // A folded sidebar shows the marks only; the choice is kept per browser. Read through an external store so the
  // server renders it open and the client takes the saved state without a state change inside an effect.
  const collapsed = useSyncExternalStore(subscribeSidebar, readSidebar, () => false);
  const toggle = () => writeSidebar(!collapsed);
  return (
    <div className={`shell ${collapsed ? "collapsed" : ""}`}>
      <aside className="sidebar">
        <Link href="/" className="wordmark" title="Roster Finance"><i /><span>Roster Finance</span></Link>
        <nav aria-label="App">
          {NAV.map((g) => (
            <div key={g.group} className="contents">
              <div className="group">{g.group}</div>
              {g.items.map((it) => {
                const soon = "soonOn" in it && (it.soonOn as string[]).includes(cluster.cluster);
                return (
                  <Link key={it.href} href={withMarket(it.href)} aria-current={it.match(pathname) ? "page" : undefined} className={soon ? "soon" : undefined} title={collapsed ? it.label : undefined}>
                    {it.match(pathname) ? <motion.i className="pill" layoutId="nav-pill" aria-hidden transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 38, mass: 0.6 }} /> : null}
                    <it.icon />
                    <span className="nav-lbl">{it.label}</span>
                    {soon ? <span className="soon-tag">soon</span> : null}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <button type="button" className="sb-toggle" onClick={toggle} aria-label={collapsed ? "Expand the sidebar" : "Collapse the sidebar"} aria-expanded={!collapsed} title={collapsed ? "Expand" : "Collapse"}>
          <Icon.Sidebar />
          <span>Collapse</span>
        </button>
      </aside>
      <div className="min-w-0">
        <header className="topbar">
          <div className="crumbs">
            <span>Roster Finance</span>
            <span>/</span>
            <b>{CRUMB[first] ?? first}</b>
          </div>
          <div className="flex items-center gap-2">
            <Badge dot tone={cluster.programDeployed ? "green" : "amber"}>{cluster.label}</Badge>
            <WalletMenu />
          </div>
        </header>
        <main className="main">{children}</main>
      </div>
    </div>
  );
}
