"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { Icon } from "@/components/icons";
import { WalletMenu } from "@/components/wallet-menu";
import { useCluster } from "@/lib/cluster";
import { Badge } from "@/components/ui";

const NAV = [
  { group: "Trade", items: [
    { href: "/trade", label: "Terms", icon: Icon.Grid, match: (p: string) => p.startsWith("/trade") },
    { href: "/positions", label: "Positions", icon: Icon.Wallet, match: (p: string) => p.startsWith("/positions") }
  ] },
  { group: "Supply", items: [
    { href: "/underwrite", label: "Underwrite", icon: Icon.Coins, match: (p: string) => p.startsWith("/underwrite") },
    { href: "/roster", label: "Roster", icon: Icon.Shield, match: (p: string) => p.startsWith("/roster") }
  ] },
  { group: "Desks", items: [
    { href: "/buy", label: "Protected Buy", icon: Icon.Lock, match: (p: string) => p.startsWith("/buy") },
    { href: "/pre-ipo", label: "First Print", icon: Icon.Building, match: (p: string) => p.startsWith("/pre-ipo") }
  ] }
];

const CRUMB: Record<string, string> = { trade: "Terms", positions: "Positions", underwrite: "Underwrite", roster: "Roster", buy: "Protected Buy", "pre-ipo": "First Print" };

/** The market the screen is on, from `?m=` or the term id, so the nav keeps it when moving between screens. */
function useMarketParam(pathname: string): string | null {
  const params = useSearchParams();
  const m = params.get("m");
  if (m) return m;
  const term = pathname.match(/^\/trade\/([a-z0-9]+)-(?:call|put)-/);
  return term ? term[1]!.toUpperCase().replace(/X$/, "x") : null;
}

/** The product shell: sidebar with grouped nav, sticky topbar with crumbs, the cluster on every screen (CLAUDE.md 4.4). */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={null}>
      <Shell>{children}</Shell>
    </Suspense>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const cluster = useCluster();
  const market = useMarketParam(pathname);
  const withMarket = (href: string) => (market && ["/trade", "/underwrite", "/roster"].includes(href) ? `${href}?m=${encodeURIComponent(market)}` : href);
  const first = pathname.split("/")[1] ?? "";
  return (
    <div className="shell">
      <aside className="sidebar">
        <Link href="/" className="wordmark"><i />Roster Finance</Link>
        <nav aria-label="App">
          {NAV.map((g) => (
            <div key={g.group} className="contents">
              <div className="group">{g.group}</div>
              {g.items.map((it) => (
                <Link key={it.href} href={withMarket(it.href)} aria-current={it.match(pathname) ? "page" : undefined}>
                  <it.icon />
                  {it.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="foot mt-auto small" style={{ padding: "0 10px" }}>
          <div className="flex items-center gap-2">
            <Badge tone={cluster.programDeployed ? "green" : "amber"} dot>{cluster.label}</Badge>
          </div>
          <p className="mt-3" style={{ margin: "12px 0 0" }}>{cluster.programDeployed ? "Fully collateralized contracts on tokenized stocks. Contracts can expire worthless." : "Program not deployed on this cluster. Premiums, reserves and positions are fixtures; expiries follow the clock."}</p>
        </div>
      </aside>
      <div className="min-w-0">
        <header className="topbar">
          <div className="crumbs">
            <span>Roster Finance</span>
            <span>/</span>
            <b>{CRUMB[first] ?? first}</b>
            <span>·</span>
            <Badge tone={cluster.programDeployed ? "green" : "amber"} dot>{cluster.label}</Badge>
          </div>
          <WalletMenu />
        </header>
        <main className="main">{children}</main>
      </div>
    </div>
  );
}
