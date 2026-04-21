import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatUSD, formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function PlansPage() {
  const supabase = createSupabaseServerClient();
  const { data } = await supabase
    .from("plans")
    .select(
      "id, name, country, aum_usd, tier, scrape_method, last_scraped_at, active",
    )
    .order("aum_usd", { ascending: false });

  const plans = data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <h1 className="text-[15px] font-semibold tracking-tightish text-ink leading-tight">
          Plans
        </h1>
        <span className="num tabular-nums text-[12px] text-ink-muted">
          {plans.length} monitored
        </span>
      </div>

      <div className="card-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-line">
                <Th>Plan</Th>
                <Th className="w-[84px]">Country</Th>
                <Th className="text-right w-[120px]">AUM</Th>
                <Th className="w-[64px]">Tier</Th>
                <Th className="w-[140px]">Method</Th>
                <Th className="w-[120px]">Last scraped</Th>
                <Th className="w-[72px]">Active</Th>
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => (
                <tr
                  key={p.id}
                  className="h-11 border-b border-line last:border-b-0 odd:bg-black/[0.015] dark:odd:bg-white/[0.02] hover:bg-bg-hover transition-colors duration-150"
                >
                  <td className="px-4 py-0 align-middle text-[13px] text-ink">
                    {p.name}
                  </td>
                  <td className="px-4 py-0 align-middle num text-[12.5px] text-ink-muted">
                    {p.country}
                  </td>
                  <td className="px-4 py-0 align-middle text-right num tabular-nums text-[13px] text-ink">
                    {formatUSD(p.aum_usd)}
                  </td>
                  <td className="px-4 py-0 align-middle num text-[12.5px] text-ink-muted">
                    T{p.tier ?? "—"}
                  </td>
                  <td className="px-4 py-0 align-middle text-[12.5px] text-ink-muted">
                    {p.scrape_method ?? "—"}
                  </td>
                  <td className="px-4 py-0 align-middle num text-[12px] text-ink-muted">
                    {formatDate(p.last_scraped_at)}
                  </td>
                  <td className="px-4 py-0 align-middle text-[12.5px] text-ink-muted">
                    {p.active ? "Yes" : "No"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Th({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={
        "text-left font-normal text-[12px] text-ink-faint px-4 h-9 bg-bg-subtle " +
        className
      }
    >
      {children}
    </th>
  );
}
