import { redirect } from "next/navigation";

/** `/trade` moved to `/markets`; `/trade?m=SYMBOL` opens that market's page. The Act route `/trade/[term]` is unchanged. */
export default async function TradePage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const { m } = await searchParams;
  redirect(m ? `/markets/${encodeURIComponent(m)}` : "/markets");
}
