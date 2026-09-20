import { NextResponse } from "next/server";
import { intentEnabled, intentToProposal, parseIntent, phrase, resolveIntent, type Proposal } from "@/lib/intent";
import { rosterData } from "@/lib/roster-data";

export const dynamic = "force-dynamic";

/** Whether the intent box exists on this deployment: it is absent without a key, never stubbed. */
export async function GET() {
  return NextResponse.json({ enabled: intentEnabled() }, { headers: { "cache-control": "no-store" } });
}

/** A sentence in, a priced ticket out, or a plain reason why not. The model parses; the app prices. */
export async function POST(req: Request) {
  if (!intentEnabled()) return NextResponse.json({ error: "The intent box is off on this deployment." }, { status: 503 });
  let body: { text?: unknown; stage?: unknown; proposal?: unknown } = {};
  try { body = (await req.json()) as typeof body; } catch { /* falls through to the checks below */ }
  try {
    // Stage "phrase": the page already has the ticket and asks for the wording; the number check still applies.
    if (body.stage === "phrase" && body.proposal && typeof body.proposal === "object") {
      const p = body.proposal as Proposal;
      return NextResponse.json({ explanation: await phrase(p) }, { headers: { "cache-control": "no-store" } });
    }
    const text = String(body.text ?? "").trim();
    if (!text || text.length > 300) return NextResponse.json({ error: "Say what you want in one sentence, up to 300 characters." }, { status: 400 });
    // Stage "resolve": the ticket with the app's own sentence, so the page can show it before the wording arrives.
    if (body.stage === "resolve") {
      const data = await rosterData();
      const intent = await parseIntent(text, data.markets.map((m) => ({ symbol: m.symbol, name: m.name, underlyingSymbol: m.underlyingSymbol })));
      const r = await resolveIntent(intent);
      return NextResponse.json(r, { status: "error" in r ? 422 : 200, headers: { "cache-control": "no-store" } });
    }
    const r = await intentToProposal(text);
    return NextResponse.json(r, { status: "error" in r ? 422 : 200, headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: `Could not read that right now: ${(e as Error).message.slice(0, 160)}` }, { status: 502 });
  }
}
