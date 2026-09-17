import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  devIndicators: false,
  outputFileTracingRoot: new URL("../../", import.meta.url).pathname,
  images: { remotePatterns: [{ protocol: "https", hostname: "**" }] }
};

export default nextConfig;
