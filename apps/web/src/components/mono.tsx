import type { ReactNode } from "react";

/** A figure set in mono, as the copy spec marks values in backticks. */
export function M({ children }: { children: ReactNode }) {
  return (
    <code className="mono num" style={{ color: "var(--text)", background: "rgba(255,255,255,0.06)", borderRadius: 3, padding: "1px 5px" }}>
      {children}
    </code>
  );
}
