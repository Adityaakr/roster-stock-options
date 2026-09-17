import { NextResponse, type NextRequest } from "next/server";

/*
 * The geo gate (Part 2 section 6): requests from blocked jurisdictions get a plain page instead of the app and its
 * transaction routes. The country comes from the edge in front of the app (Vercel's x-vercel-ip-country, Cloudflare's
 * cf-ipcountry); with neither header present nothing is blocked, and that is stated in docs/OPERATOR.md.
 * The marketing pages, risk, fees, terms and privacy stay readable everywhere.
 */
const BLOCKED = new Set((process.env.GEO_BLOCKED_COUNTRIES ?? "US").split(",").map((c) => c.trim().toUpperCase()).filter(Boolean));

export function proxy(req: NextRequest) {
  const country = (req.headers.get("x-vercel-ip-country") ?? req.headers.get("cf-ipcountry") ?? "").toUpperCase();
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
