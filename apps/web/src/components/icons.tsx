import type { SVGProps } from "react";

const base = (props: SVGProps<SVGSVGElement>) => ({ width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, ...props });

/** Thin line icons, sized by the parent. */
export const Icon = {
  Spark: (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" /><path d="M19 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2z" /></svg>,
  Grid: (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>,
  Wallet: (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M3 7a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" /><path d="M16 12h4" /><circle cx="16" cy="12" r="1" fill="currentColor" /></svg>,
  Layers: (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="m12 3 9 5-9 5-9-5 9-5z" /><path d="m3 13 9 5 9-5" /></svg>,
  File: (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z" /><path d="M14 3v5h5" /><path d="M9 13h6M9 17h6" /></svg>,
  Console: (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m7 9 3 3-3 3M13 15h4" /></svg>,
  Plug: (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0V8zM12 17v4" /></svg>,
  Shield: (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3z" /><path d="m9 12 2 2 4-4" /></svg>,
  Eye: (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>,
  Tree: (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><rect x="9" y="3" width="6" height="4" rx="1" /><rect x="3" y="17" width="6" height="4" rx="1" /><rect x="15" y="17" width="6" height="4" rx="1" /><path d="M12 7v5M12 12H6v5M12 12h6v5" /></svg>,
  Check: (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="m5 12 4 4L19 6" /></svg>,
  Chevron: (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="m6 9 6 6 6-6" /></svg>,
  Search: (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>,
  Coins: (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><ellipse cx="9" cy="7" rx="6" ry="3" /><path d="M3 7v5c0 1.7 2.7 3 6 3s6-1.3 6-3V7" /><path d="M3 12v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5" /><path d="M15 9.5c3.3 0 6 1.3 6 3v5c0 1.7-2.7 3-6 3" /></svg>,
  Vote: (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M5 12h14v8H5z" /><path d="m9 9 2 2 5-5" /><path d="M8 12V5h8v7" /></svg>,
  Route: (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><circle cx="6" cy="18" r="2" /><circle cx="18" cy="6" r="2" /><path d="M8 18h6a4 4 0 0 0 0-8H10a4 4 0 0 1 0-8h6" /></svg>,
  Arrow: (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M5 12h14M13 6l6 6-6 6" /></svg>,
  External: (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" /></svg>,
  Lock: (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>,
  Enter: (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M20 5v6a3 3 0 0 1-3 3H5" /><path d="m9 10-4 4 4 4" /></svg>,
  Sidebar: (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></svg>,
  Building: (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M3 21h18M5 21V5l7-2 7 2v16" /><path d="M9 9h2M13 9h2M9 13h2M13 13h2M9 17h2M13 17h2" /></svg>
};
