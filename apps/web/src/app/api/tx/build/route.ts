import { NextResponse } from "next/server";
import { buildTransaction, type BuildRequest } from "@/lib/tx-server";

export const dynamic = "force-dynamic";

/** Build an unsigned transaction for the browser wallet to sign. Nothing here signs or holds a key. */
export async function POST(req: Request) {
  let body: BuildRequest;
  try {
    body = (await req.json()) as BuildRequest;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  try {
    return NextResponse.json(await buildTransaction(body));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
