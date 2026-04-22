import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatUSD, formatDate } from "@/lib/utils";
import {
  privateMarketsUnfundedUsd,
  PRIVATE_MARKETS_CLASSES,
  unfundedUsd,
} from "@/lib/relevance/unfunded";

export const dynamic = "force-dynamic";

type Allocation = {
  id: string;
  as_of_date: string;
  asset_class: string;
  target_pct: number;
  target_min_pct: number | null;
  target_max_pct: number | null;
  actual_pct: number | null;
  actual_usd: number | null;
  total_plan_aum_usd: number | null;
  source_page: number | null;
  source_quote: string | null;
  confidence: number;
  preliminary: boolean;
};

export default async function PensionProfilePage({
  params,
}: {
  params: { slug: string };
}) {
  const supabase = createSupabaseServerClient();

  // Slug = scrape_config.key. Cheap to query across all plans and filter in JS
  // since the total row count is tiny (~12 plans).
  const { data: plans } = await supabase
    .from("plans")
    .select("id, name, country, aum_usd, tier, scrape_config, last_scraped_at");
  const plan = plans?.find(
    (p) =>
      typeof p.scrape_config === "object" &&
      p.scrape_config &&
      (p.scrape_config as Record<string, unknown>).key === params.slug,
  );
  if (!plan) notFound();

  // Latest allocation snapshot for this plan. Sort DESC by as_of_date so the
  // first row's date is the newest; render only that snapshot's rows.
  const { data: allocData } = await supabase
    .from("pension_allocations")
    .select(
      "id, as_of_date, asset_class, target_pct, target_min_pct, target_max_pct, actual_pct, actual_usd, total_plan_aum_usd, source_page, source_quote, confidence, preliminary",
    )
    .eq("plan_id", plan.id)
    .order("as_of_date", { ascending: false })
    .order("asset_class", { ascending: true });

  const rows = (allocData ?? []) as Allocation[];
  const latestAsOf = rows[0]?.as_of_date ?? null;
  const latest = rows.filter((r) => r.as_of_date === latestAsOf);
  const totalAum =
    latest.find((r) => r.total_plan_aum_usd)?.total_plan_aum_usd ?? null;

  // Unfunded budget = (target − actual) / 100 × AUM, capped at zero, summed
  // across private-markets asset classes. This is the cold-email headline.
  const headlineUnfunded = privateMarketsUnfundedUsd(latest);
  const perClassUnfunded: Array<{ asset_class: string; unfunded_usd: number }> =
    latest
      .filter((r) =>
        (PRIVATE_MARKETS_CLASSES as readonly string[]).includes(r.asset_class),
      )
      .map((r) => ({ asset_class: r.asset_class, unfunded_usd: unfundedUsd(r) }))
      .filter((r) => r.unfunded_usd > 0)
      .sort((a, b) => b.unfunded_usd - a.unfunded_usd);

  // Detected policy changes for this plan (most recent first).
  const { data: policyChanges } = await supabase
    .from("allocation_policy_changes")
    .select(
      "id, asset_class, previous_target_pct, new_target_pct, change_pp, change_direction, as_of_date_previous, as_of_date_new, implied_usd_delta",
    )
    .eq("plan_id", plan.id)
    .order("as_of_date_new", { ascending: false })
    .order("asset_class", { ascending: true });

  // Signal recent activity — link to the board-minutes signals for this plan.
  const { count: signalsCount } = await supabase
    .from("signals")
    .select("id", { count: "exact", head: true })
    .eq("plan_id", plan.id)
    .not("validated_at", "is", null);

  return (
    <div className="space-y-4 max-w-5xl">
      <Link
        href="/plans"
        className="inline-flex items-center gap-1 text-[12px] text-ink-muted hover:text-ink"
      >
        <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
        Plans
      </Link>

      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[16px] font-semibold tracking-tightish text-ink leading-tight">
            {plan.name}
          </h1>
          <div className="mt-1 text-[12px] text-ink-muted">
            {plan.country} · AUM {formatUSD(plan.aum_usd)} · Tier{" "}
            {plan.tier ?? "—"} · last scraped {formatDate(plan.last_scraped_at)}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[11px] text-ink-faint">Signals</div>
          <div className="num tabular-nums text-[20px] font-semibold text-ink">
            {signalsCount ?? 0}
          </div>
        </div>
      </div>

      {/* Headline unfunded budget — only show if we have private-markets data. */}
      {headlineUnfunded > 0 ? (
        <section className="card-surface px-4 py-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-[12px] text-ink-muted">
                Private-markets unfunded budget
              </div>
              <div className="num tabular-nums text-[24px] font-semibold text-ink mt-0.5 leading-none">
                {formatUSD(headlineUnfunded)}
              </div>
              <div className="text-[11px] text-ink-faint mt-1">
                Sum of (target − actual) × AUM across PE / Infra / Credit / RE / VC.
                Underweight only; overweights capped at zero.
              </div>
            </div>
            {perClassUnfunded.length > 0 ? (
              <div className="flex flex-wrap gap-3 max-w-[60%] justify-end">
                {perClassUnfunded.map((b) => (
                  <div
                    key={b.asset_class}
                    className="border border-line rounded-sm px-2.5 py-1.5 min-w-[88px]"
                  >
                    <div className="text-[10.5px] text-ink-faint uppercase tracking-wide">
                      {b.asset_class}
                    </div>
                    <div className="num tabular-nums text-[13px] text-ink font-medium leading-tight">
                      {formatUSD(b.unfunded_usd)}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* Asset Allocation */}
      <section className="card-surface">
        <div className="px-4 py-3 border-b border-line flex items-end justify-between gap-4">
          <div>
            <div className="text-[13px] font-medium text-ink">
              Asset Allocation
            </div>
            <div className="mt-0.5 text-[12px] text-ink-muted">
              {latestAsOf ? (
                <>
                  Target vs actual as of{" "}
                  <span className="num tabular-nums">
                    {formatDate(latestAsOf)}
                  </span>
                  . Gap = target − actual. Positive gap = unfunded budget.
                </>
              ) : (
                "No CAFR allocations ingested yet."
              )}
            </div>
          </div>
          {totalAum ? (
            <div className="text-right">
              <div className="text-[11px] text-ink-faint">Plan AUM</div>
              <div className="num tabular-nums text-[13px] text-ink font-medium">
                {formatUSD(totalAum)}
              </div>
            </div>
          ) : null}
        </div>

        {latest.length === 0 ? (
          <div className="px-4 py-6 text-center text-[12px] text-ink-muted">
            Ingest this plan&apos;s CAFR to populate allocation data.
          </div>
        ) : (
          <AllocationTable rows={latest} totalAum={totalAum} />
        )}
      </section>

      {/* Policy changes — only render section if there's data to show. */}
      {policyChanges && policyChanges.length > 0 ? (
        <section className="card-surface">
          <div className="px-4 py-3 border-b border-line">
            <div className="text-[13px] font-medium text-ink">
              Policy changes
            </div>
            <div className="mt-0.5 text-[12px] text-ink-muted">
              Target allocation moves between consecutive CAFR snapshots.
              Increases (green) point to net new deployment budget; decreases
              (red) signal program wind-downs or rebalances.
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-line text-ink-faint">
                  <Th>Asset Class</Th>
                  <Th className="text-right w-[120px]">Previous</Th>
                  <Th className="text-right w-[120px]">New</Th>
                  <Th className="text-right w-[100px]">Δ (pp)</Th>
                  <Th className="text-right w-[140px]">Implied $</Th>
                  <Th className="text-right w-[180px]">Period</Th>
                </tr>
              </thead>
              <tbody>
                {policyChanges.map((c) => {
                  const isInc = c.change_direction === "increase";
                  const isDec = c.change_direction === "decrease";
                  return (
                    <tr
                      key={c.id}
                      className="h-11 border-b border-line last:border-b-0 odd:bg-black/[0.015] dark:odd:bg-white/[0.02]"
                    >
                      <td className="px-4 py-0 align-middle text-ink">
                        {c.asset_class}
                      </td>
                      <td className="px-4 py-0 align-middle text-right num tabular-nums text-ink-muted">
                        {fmtPct(Number(c.previous_target_pct))}
                      </td>
                      <td className="px-4 py-0 align-middle text-right num tabular-nums text-ink">
                        {fmtPct(Number(c.new_target_pct))}
                      </td>
                      <td className="px-4 py-0 align-middle text-right">
                        <span
                          className={
                            "num tabular-nums font-medium " +
                            (isInc
                              ? "text-green-700 dark:text-green-400"
                              : isDec
                              ? "text-red-700 dark:text-red-400"
                              : "text-ink-muted")
                          }
                        >
                          {Number(c.change_pp) > 0 ? "+" : ""}
                          {fmtPct(Number(c.change_pp))}
                        </span>
                      </td>
                      <td className="px-4 py-0 align-middle text-right">
                        {c.implied_usd_delta != null ? (
                          <span
                            className={
                              "num tabular-nums " +
                              (Number(c.implied_usd_delta) > 0
                                ? "text-green-700 dark:text-green-400"
                                : Number(c.implied_usd_delta) < 0
                                ? "text-red-700 dark:text-red-400"
                                : "text-ink-muted")
                            }
                          >
                            {Number(c.implied_usd_delta) > 0 ? "+" : "−"}
                            {formatUSD(Math.abs(Number(c.implied_usd_delta)))}
                          </span>
                        ) : (
                          <span className="text-ink-faint">—</span>
                        )}
                      </td>
                      <td className="px-4 py-0 align-middle text-right num tabular-nums text-[11.5px] text-ink-muted">
                        {formatDate(c.as_of_date_previous)} →{" "}
                        {formatDate(c.as_of_date_new)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function AllocationTable({
  rows,
  totalAum,
}: {
  rows: Allocation[];
  totalAum: number | null;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-line text-ink-faint">
            <Th>Asset Class</Th>
            <Th className="text-right w-[120px]">Target %</Th>
            <Th className="text-right w-[140px]">Policy Range</Th>
            <Th className="text-right w-[100px]">Actual %</Th>
            <Th className="text-right w-[100px]">Gap (pp)</Th>
            <Th className="text-right w-[140px]">$ Gap</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const gapPct =
              r.actual_pct != null ? r.target_pct - r.actual_pct : null;
            const gapUsd =
              gapPct != null && totalAum
                ? Math.round((gapPct / 100) * totalAum)
                : null;
            const tone =
              gapPct == null
                ? "neutral"
                : gapPct > 0.5
                ? "positive"
                : gapPct < -0.5
                ? "negative"
                : "neutral";
            return (
              <tr
                key={r.id}
                className="h-11 border-b border-line last:border-b-0 odd:bg-black/[0.015] dark:odd:bg-white/[0.02]"
                title={r.source_quote ?? undefined}
              >
                <td className="px-4 py-0 align-middle text-ink">
                  <div className="flex items-center gap-2">
                    <span>{r.asset_class}</span>
                    {r.preliminary ? (
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-ink-dim" />
                    ) : null}
                  </div>
                </td>
                <td className="px-4 py-0 align-middle text-right num tabular-nums text-ink">
                  {fmtPct(r.target_pct)}
                </td>
                <td className="px-4 py-0 align-middle text-right num tabular-nums text-ink-muted">
                  {r.target_min_pct != null && r.target_max_pct != null
                    ? `${fmtPct(r.target_min_pct)} – ${fmtPct(r.target_max_pct)}`
                    : "—"}
                </td>
                <td className="px-4 py-0 align-middle text-right num tabular-nums text-ink-muted">
                  {r.actual_pct != null ? fmtPct(r.actual_pct) : "—"}
                </td>
                <td className="px-4 py-0 align-middle text-right">
                  {gapPct != null ? (
                    <span
                      className={
                        "num tabular-nums font-medium " +
                        (tone === "positive"
                          ? "text-green-700 dark:text-green-400"
                          : tone === "negative"
                          ? "text-red-700 dark:text-red-400"
                          : "text-ink-muted")
                      }
                    >
                      {gapPct > 0 ? "+" : ""}
                      {fmtPct(gapPct)}
                    </span>
                  ) : (
                    <span className="text-ink-faint">—</span>
                  )}
                </td>
                <td className="px-4 py-0 align-middle text-right">
                  {gapUsd != null ? (
                    <span
                      className={
                        "num tabular-nums " +
                        (gapUsd > 0
                          ? "text-green-700 dark:text-green-400"
                          : gapUsd < 0
                          ? "text-red-700 dark:text-red-400"
                          : "text-ink-muted")
                      }
                    >
                      {gapUsd > 0 ? "+" : gapUsd < 0 ? "−" : ""}
                      {formatUSD(Math.abs(gapUsd))}
                    </span>
                  ) : (
                    <span className="text-ink-faint">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function fmtPct(v: number): string {
  return `${v.toFixed(1)}%`;
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
