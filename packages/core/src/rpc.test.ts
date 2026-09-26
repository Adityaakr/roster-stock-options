import { afterEach, describe, expect, it, vi } from "vitest";
import { failoverFetch } from "./rpc";

const ok = () => new Response(JSON.stringify({ jsonrpc: "2.0", result: 1, id: 1 }), { status: 200 });
const quota = () => new Response(JSON.stringify({ error: { code: 429, message: "Monthly capacity limit exceeded. Visit the dashboard to upgrade" } }), { status: 429 });

afterEach(() => vi.unstubAllGlobals());

describe("failoverFetch", () => {
  it("benches an endpoint whose quota is spent and stops calling it", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => { calls.push(url); return url.includes("spent") ? quota() : ok(); }));
    const f = failoverFetch(["https://spent.example/rpc", "https://backup.example/rpc"], 1_000);
    for (let i = 0; i < 5; i++) expect((await f("x", { method: "POST" })).status).toBe(200);
    // One refusal names the quota; after that, every read goes straight to the backup.
    expect(calls.filter((u) => u.includes("spent")).length).toBe(1);
    expect(calls.filter((u) => u.includes("backup")).length).toBe(5);
  });

  it("retries a keyed burst 429 on the same endpoint before detouring", async () => {
    let n = 0;
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => { calls.push(url); if (url.includes("primary") && n++ === 0) return new Response("{}", { status: 429 }); return ok(); }));
    const f = failoverFetch(["https://primary.example/rpc", "https://backup.example/rpc"], 1_000);
    expect((await f("x", { method: "POST" })).status).toBe(200);
    expect(calls).toEqual(["https://primary.example/rpc", "https://primary.example/rpc"]);
  });
});
