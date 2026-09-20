import { NextResponse } from "next/server";
import { services, servicesReachable } from "@/lib/services";

export const dynamic = "force-dynamic";

/** Every vault the services run, with balances and the epoch records they have published. */
export async function GET() {
  if (!(await servicesReachable())) return NextResponse.json([]);
  try {
    return NextResponse.json(await services.vaults());
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
