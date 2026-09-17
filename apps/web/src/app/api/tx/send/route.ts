import { NextResponse } from "next/server";
import { sendSigned } from "@/lib/tx-server";

export const dynamic = "force-dynamic";

/** Submit a wallet-signed transaction through the app's RPC and wait for confirmation. */
export async function POST(req: Request) {
  let body: { signed: string; lastValidBlockHeight: number };
  try {
    body = (await req.json()) as { signed: string; lastValidBlockHeight: number };
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  try {
    const signature = await sendSigned(body.signed, body.lastValidBlockHeight);
    return NextResponse.json({ signature });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
