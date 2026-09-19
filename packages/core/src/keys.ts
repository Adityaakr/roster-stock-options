/*
 * Where a signing key comes from. On a laptop it is a file under .keys; on a host there is no file system worth
 * trusting, so the same key arrives as an environment variable holding the secret key as a JSON array. The env wins
 * when both exist, because a deployment that sets one means it.
 */
import { existsSync, readFileSync } from "node:fs";

/** Parse a secret key given as a JSON array of 64 bytes. Anything else is refused by name, never half-read. */
export function secretKeyFromJson(text: string, where: string): Uint8Array {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${where} is not JSON: a secret key is the 64 byte array solana-keygen writes`);
  }
  if (!Array.isArray(parsed) || (parsed.length !== 64 && parsed.length !== 32)) throw new Error(`${where} is not a 64 byte secret key array`);
  return new Uint8Array(parsed as number[]);
}

/**
 * The secret key for a role: `<ROLE>_SECRET_KEY` (the array itself), else `<ROLE>_KEYPAIR` or the given path as a
 * file. Returns null when neither is present, so a caller can decide whether that role is required.
 */
export function loadSecretKey(role: "DEPLOYER" | "KEEPER" | "QUOTER", fallbackPath: string): Uint8Array | null {
  const inline = process.env[`${role}_SECRET_KEY`];
  if (inline && inline.trim()) return secretKeyFromJson(inline.trim(), `${role}_SECRET_KEY`);
  const path = process.env[`${role}_KEYPAIR`] ?? fallbackPath;
  if (!existsSync(path)) return null;
  return secretKeyFromJson(readFileSync(path, "utf8"), path);
}
