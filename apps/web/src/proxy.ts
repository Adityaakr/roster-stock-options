import { NextResponse, type NextRequest } from "next/server";

/*
 * The geo gate (Part 2 section 6): requests from blocked jurisdictions get a plain page instead of the app and its
 * transaction routes. The country comes from ONE header the deployed edge sets (GEO_HEADER, default Vercel's
 * x-vercel-ip-country; Cloudflare's is cf-ipcountry); any other country header a client sends is ignored, since the
 * edge overwrites only its own. With no such header nothing is blocked, and that is stated in docs/OPERATOR.md.
 * The marketing pages, risk, fees, terms and privacy stay readable everywhere.
 */
const BLOCKED = new Set((process.env.GEO_BLOCKED_COUNTRIES ?? "US").split(",").map((c) => c.trim().toUpperCase()).filter(Boolean));
const GEO_HEADER = (process.env.GEO_HEADER ?? "x-vercel-ip-country").toLowerCase();

export function proxy(req: NextRequest) {
  const country = (req.headers.get(GEO_HEADER) ?? "").trim().toUpperCase();
  if (country && BLOCKED.has(country)) {
    if (req.nextUrl.pathname.startsWith("/api/")) return NextResponse.json({ error: "not available in your region" }, { status: 451 });
    const url = req.nextUrl.clone();
    url.pathname = "/unavailable";
    return NextResponse.rewrite(url, { status: 451 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/trade/:path*", "/positions/:path*", "/underwrite/:path*", "/roster/:path*", "/buy/:path*", "/pre-ipo/:path*", "/api/tx/:path*", "/api/positions/:path*"]
};
