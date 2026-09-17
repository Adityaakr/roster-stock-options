import type { NextConfig } from "next";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// One .env at the repo root serves every process (scripts/env.ts does the same for the services). Values already in
// the environment win, so a deployment sets them the usual way. Empty values in the file do not override anything.
const root = resolve(process.cwd(), "../..");
for (const file of [".env", ...(process.env.ROSTER_ENV ? [`.env.${process.env.ROSTER_ENV}`] : [])]) {
  const path = resolve(root, file);
  if (!existsSync(path)) continue;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && m[1] && m[2] && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

const nextConfig: NextConfig = {
  agentRules: false,
  devIndicators: false,
  outputFileTracingRoot: new URL("../../", import.meta.url).pathname,
  images: { remotePatterns: [{ protocol: "https", hostname: "**" }] },
  // Workspace packages ship TypeScript source; Next compiles them in place.
  transpilePackages: ["@roster/sdk", "@roster/core"],
  // Anchor's ESM build references `exports`; let Node load it as CommonJS on the server instead of bundling it.
  serverExternalPackages: ["@anchor-lang/core"]
};

export default nextConfig;
