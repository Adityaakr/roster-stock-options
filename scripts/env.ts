/**
 * Load `.env` and, when ROSTER_ENV is set, `.env.<name>` on top of it. Real process env wins, except that a
 * profile value replaces one that `dotenv/config` (imported by the packages) already copied from `.env`.
 * Import `./env-load` as the first import of a script so this runs before other modules read process.env.
 */
import { existsSync, readFileSync } from "node:fs";

function parse(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && m[1]) out[m[1]] = m[2] ?? "";
  }
  return out;
}

export function loadEnvFile(env: NodeJS.ProcessEnv = process.env): void {
  const base = parse(".env");
  // An empty value in the file is "not set": every default in the code keeps working with the example file copied as-is.
  for (const [k, v] of Object.entries(base)) if (env[k] === undefined && v !== "") env[k] = v;
  if (!env.ROSTER_ENV) return;
  const profile = parse(`.env.${env.ROSTER_ENV}`);
  for (const [k, v] of Object.entries(profile)) if (v !== "" && (env[k] === undefined || env[k] === base[k])) env[k] = v;
}
