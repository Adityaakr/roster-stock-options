import type { ReactNode } from "react";
import { SiteNav } from "@/components/site-chrome";

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteNav />
      {children}
    </>
  );
}
