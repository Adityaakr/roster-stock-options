import { NextResponse } from "next/server";
import { intentEnabled, intentToProposal } from "@/lib/intent";

export const dynamic = "force-dynamic";

/** Whether the intent box exists on this deployment: it is absent without a key, never stubbed. */
export async function GET() {
  return NextResponse.json({ enabled: intentEnabled() }, { headers: { "cache-control": "no-store" } });
}

/** A sentence in, a priced ticket out, or a plain reason why not. The model parses; the app prices. */
export async function POST(req: Request) {
  if (!intentEnabled()) return NextResponse.json({ error: "The intent box is off on this deployment." }, { status: 503 });
  let text = "";
  try { text = String(((await req.json()) as { text?: unknown }).text ?? "").trim(); } catch { /* falls through to the length check */ }
  if (!text || text.length > 300) return NextResponse.json({ error: "Say what you want in one sentence, up to 300 characters." }, { status: 400 });
  try {
    const r = await intentToProposal(text);
    return NextResponse.json(r, { status: "error" in r ? 422 : 200, headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: `Could not read that right now: ${(e as Error).message.slice(0, 160)}` }, { status: 502 });
  }
}
