import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatUSD, formatDate } from "@/lib/utils";
import {
  availabilityFor,
  isEmpty,
  type AvailabilityStatus,
} from "@/lib/plans/data-availability";
import { resolvePlanAum } from "@/lib/relevance/plan-aum";

export const dynamic = "force-dynamic";

export default async function PlansPage() {
  const supabase = createSupabaseServerClient();
  const [
    { data: plans },
    { data: signalRows },
    { data: allocRows },
    { data: docRows },
  ] = await Promise.all([
    supabase
      .from("plans")
      .select(
        "id, name, country, aum_usd, tier, scrape_method, last_scraped_at, active, scrape_config",
      )
      .order("aum_usd", { ascending: false }),
    supabase
      .from("signals")
      .select("plan_id")
      .eq("seed_data", false)
      .not("validated_at", "is", null),
    // Rollup view: one row per (plan, asset_class). Drives the
    // "Allocations" count column AND the resolved AUM (max
    // total_plan_aum_usd per plan, which is the latest CAFR snapshot).
    supabase
      .from("pension_allocations_rollup")
      .select("plan_id, total_plan_aum_usd, as_of_date"),
    supabase
      .from("documents")
      .select("plan_id")
      .eq("processing_status", "complete"),
  ]);

  const signalsByPlan = countBy((signalRows ?? []) as { plan_id: string | null }[]);
  const docsByPlan = countBy((docRows ?? []) as { plan_id: string | null }[]);

  // For each plan: count distinct rollup rows + resolve AUM from the
  // largest total_plan_aum_usd in the latest snapshot. Same value for
  // every row of a given (plan, as_of_date), so any non-null pick works.
  type AllocRow = {
    plan_id: string | null;
    total_plan_aum_usd: number | null;
    as_of_date: string | null;
  };
  const allocByPlan = new Map<
    string,
    { count: number; aum: number | null; asOf: string | null }
  >();
  for (const r of (allocRows ?? []) as AllocRow[]) {
    if (!r.plan_id) continue;
    const cur = allocByPlan.get(r.plan_id) ?? {
      count: 0,
      aum: null,
      asOf: null,
    };
    cur.count += 1;
    if (cur.aum == null && r.total_plan_aum_usd != null) {
      cur.aum = Number(r.total_plan_aum_usd);
      cur.asOf = r.as_of_date;
    }
    allocByPlan.set(r.plan_id, cur);
  }

  const rows = (plans ?? []).map((p) => {
    const a = allocByPlan.get(p.id);
    const counts = {
      signals: signalsByPlan.get(p.id) ?? 0,
      allocations: a?.count ?? 0,
      documents: docsByPlan.get(p.id) ?? 0,
    };
    const aum = resolvePlanAum(p.aum_usd, a?.aum ?? null, a?.asOf ?? null, p.name);
    return { plan: p, counts, empty: isEmpty(counts), aum };
  });

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <h1 className="text-[15px] font-semibold tracking-tightish text-ink leading-tight">
          Plans
        </h1>
        <span className="num tabular-nums text-[12px] text-ink-muted">
          {rows.length} monitored · {rows.filter((r) => !r.empty).length} with data
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
                <Th className="text-right w-[90px]">Signals</Th>
                <Th className="text-right w-[90px]">Allocations</Th>
                <Th className="w-[140px]">Method</Th>
                <Th className="w-[120px]">Last scraped</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ plan: p, counts, empty, aum }) => {
                const slug =
                  p.scrape_config &&
                  typeof p.scrape_config === "object" &&
                  typeof (p.scrape_config as Record<string, unknown>).key ===
                    "string"
                    ? ((p.scrape_config as Record<string, unknown>).key as string)
                    : null;
                const avail = empty ? availabilityFor(p.name) : null;
                return (
                  <tr
                    key={p.id}
                    className="h-11 border-b border-line last:border-b-0 odd:bg-black/[0.015] dark:odd:bg-white/[0.02] hover:bg-bg-hover transition-colors duration-150"
                  >
                    <td className="px-4 py-0 align-middle text-[13px] text-ink">
                      <div className="flex items-center gap-2">
                        {slug ? (
                          <Link
                            href={`/pensions/${slug}`}
                            className="hover:text-accent-hi hover:underline"
                          >
                            {p.name}
                          </Link>
                        ) : (
                          p.name
                        )}
                        {avail ? (
                          <AvailabilityPill
                            status={avail.status}
                            label={avail.label}
                            title={avail.reason}
                          />
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-0 align-middle num text-[12.5px] text-ink-muted">
                      {p.country}
                    </td>
                    <td className="px-4 py-0 align-middle text-right num tabular-nums text-[13px] text-ink">
                      <span
                        title={
                          aum.source === "allocation" && aum.asOfDate
                            ? `From latest CAFR snapshot, as of ${formatDate(aum.asOfDate)}`
                            : aum.source === "plan_table"
                            ? "Editorial estimate (no CAFR allocation ingested or anomaly fallback)"
                            : "AUM unavailable"
                        }
                        className="cursor-help"
                      >
                        {formatUSD(aum.value ?? p.aum_usd)}
                      </span>
                      {aum.source === "allocation" && aum.asOfDate ? (
                        <div className="text-[10.5px] text-ink-faint mt-0.5 num tabular-nums">
                          as of {formatDate(aum.asOfDate)}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-0 align-middle num text-[12.5px] text-ink-muted">
                      T{p.tier ?? "—"}
                    </td>
                    <td className="px-4 py-0 align-middle text-right num tabular-nums text-[12.5px] text-ink-muted">
                      {counts.signals}
                    </td>
                    <td className="px-4 py-0 align-middle text-right num tabular-nums text-[12.5px] text-ink-muted">
                      {counts.allocations}
                    </td>
                    <td className="px-4 py-0 align-middle text-[12.5px] text-ink-muted">
                      {p.scrape_method ?? "—"}
                    </td>
                    <td className="px-4 py-0 align-middle num text-[12px] text-ink-muted">
                      {formatDate(p.last_scraped_at)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function countBy(rows: { plan_id: string | null }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    if (!r.plan_id) continue;
    m.set(r.plan_id, (m.get(r.plan_id) ?? 0) + 1);
  }
  return m;
}

function AvailabilityPill({
  status,
  label,
  title,
}: {
  status: AvailabilityStatus;
  label: string;
  title?: string;
}) {
  const classes =
    status === "blocked"
      ? "bg-amber-100 text-amber-800 border-amber-200"
      : "bg-neutral-100 text-neutral-700 border-neutral-200";
  return (
    <span
      title={title}
      className={
        "inline-flex items-center h-5 px-1.5 rounded-sm border text-[10.5px] font-medium cursor-help " +
        classes
      }
    >
      <span
        aria-hidden
        className={
          "inline-block h-1.5 w-1.5 rounded-full mr-1 " +
          (status === "blocked" ? "bg-amber-500" : "bg-neutral-400")
        }
      />
      {label}
    </span>
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
