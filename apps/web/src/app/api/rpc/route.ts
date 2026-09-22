import { failoverFetch, rpcEndpoints } from "@roster/core";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/*
 * The browser's read path to the chain. The RPC the app uses is a paid endpoint whose key must never reach a page
 * (CLAUDE.md 4.4 and the guardrails), so the wallet adapter talks to this route and this route talks to the provider.
 *
 * Reads only. Writing is the relay's job: `/api/tx/send` accepts only a message this server built, and routing a
 * transaction around that guard through here would throw the guard away. Anything not on the list is refused by name.
 */
const READS = new Set([
  "getAccountInfo", "getBalance", "getBlockHeight", "getEpochInfo", "getFeeForMessage", "getGenesisHash",
  "getLatestBlockhash", "getMinimumBalanceForRentExemption", "getMultipleAccounts", "getRecentPrioritizationFees",
  "getSignatureStatuses", "getSignaturesForAddress", "getSlot", "getTokenAccountBalance", "getTokenAccountsByOwner",
  "getTokenSupply", "getTransaction", "getVersion", "isBlockhashValid",
]);
const MAX_BODY = 256 * 1024;

const RPC = process.env.RPC_URL ?? process.env.DEVNET_RPC_URL ?? "http://127.0.0.1:8899";

function refusal(id: unknown, message: string) {
  return NextResponse.json({ jsonrpc: "2.0", id: id ?? null, error: { code: -32601, message } }, { status: 200 });
}

export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > MAX_BODY) return NextResponse.json({ error: "body too large" }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "not JSON" }, { status: 400 });
  }
  const calls = Array.isArray(body) ? body : [body];
  for (const c of calls) {
    const method = (c as { method?: unknown }).method;
    if (typeof method !== "string" || !READS.has(method)) {
      return refusal((c as { id?: unknown }).id, `${typeof method === "string" ? method : "that method"} is not relayed; reads only, and transactions go through /api/tx/send`);
    }
  }
  const res = await failoverFetch(rpcEndpoints(RPC, process.env.NEXT_PUBLIC_CLUSTER ?? null), 20_000)(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: raw }).catch(() => null);
  if (!res) return NextResponse.json({ error: "the RPC did not answer" }, { status: 502 });
  const text = await res.text();
  return new NextResponse(text, { status: res.status, headers: { "content-type": "application/json" } });
}
