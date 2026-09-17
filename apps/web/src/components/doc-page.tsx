import type { ReactNode } from "react";
import { SiteFooter } from "@/components/site-chrome";

/** The plain-text pages: risk, terms, privacy, fees. One column, the site's type, nothing decorative. */
export function DocPage({ title, lead, updated, children }: { title: string; lead: string; updated: string; children: ReactNode }) {
  return (
    <>
      <main className="sec" style={{ paddingTop: 140 }}>
        <div style={{ maxWidth: 760, margin: "0 auto" }}>
          <p className="marker"><b>Updated {updated}</b></p>
          <h1 className="h1">{title}</h1>
          <p className="body-lg" style={{ marginTop: 16 }}>{lead}</p>
          <div className="prose" style={{ marginTop: 40 }}>{children}</div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
