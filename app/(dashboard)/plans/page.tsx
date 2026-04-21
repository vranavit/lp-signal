import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatUSD, formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function PlansPage() {
  const supabase = createSupabaseServerClient();
  const { data } = await supabase
    .from("plans")
    .select("id, name, country, aum_usd, tier, scrape_method, last_scraped_at, active")
    .order("aum_usd", { ascending: false });

  const plans = data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <div className="text-[11px] uppercase tracking-widest text-ink-faint mono">
          Dashboard / Plans
        </div>
        <h1 className="mt-1 text-lg font-semibold tracking-tightish text-ink">
          Monitored plans
        </h1>
      </div>
      <div className="border border-line">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-bg-subtle">
            <tr className="text-[10px] uppercase tracking-widest text-ink-faint">
              <th className="text-left font-normal px-3 py-2">Plan</th>
              <th className="text-left font-normal px-3 py-2 w-[80px]">Country</th>
              <th className="text-right font-normal px-3 py-2 w-[120px]">AUM</th>
              <th className="text-left font-normal px-3 py-2 w-[80px]">Tier</th>
              <th className="text-left font-normal px-3 py-2 w-[140px]">Method</th>
              <th className="text-left font-normal px-3 py-2 w-[120px]">Last scraped</th>
              <th className="text-left font-normal px-3 py-2 w-[80px]">Active</th>
            </tr>
          </thead>
          <tbody>
            {plans.map((p) => (
              <tr key={p.id} className="border-t border-line hover:bg-bg-subtle">
                <td className="px-3 py-2.5 text-ink">{p.name}</td>
                <td className="px-3 py-2.5 mono text-ink-muted">{p.country}</td>
                <td className="px-3 py-2.5 text-right mono text-ink tabular-nums">
                  {formatUSD(p.aum_usd)}
                </td>
                <td className="px-3 py-2.5 mono text-ink-muted">T{p.tier ?? "—"}</td>
                <td className="px-3 py-2.5 mono text-[11px] text-ink-muted">
                  {p.scrape_method ?? "—"}
                </td>
                <td className="px-3 py-2.5 mono text-[11px] text-ink-muted">
                  {formatDate(p.last_scraped_at)}
                </td>
                <td className="px-3 py-2.5 mono text-[11px] text-ink-muted">
                  {p.active ? "yes" : "no"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
