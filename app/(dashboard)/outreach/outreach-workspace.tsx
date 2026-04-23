"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { daysAgo, formatUSD } from "@/lib/utils";
import { CombinationFilter } from "@/components/filters/combination-filter";
import { useUrlFilterState } from "@/components/filters/use-url-filter-state";
import { tierFor } from "@/components/filters/filter-state";
import type { SignalWithPlan } from "@/lib/types";

export type OutreachRow = SignalWithPlan & {
  document: {
    id: string;
    source_url: string;
    meeting_date: string | null;
  } | null;
};

export type PlanUnfundedRow = {
  plan_id: string;
  plan_name: string;
  country: string;
  slug: string | null;
  as_of_date: string;
  unfunded_usd: number;
};

type Direction = "new" | "increase" | "decrease" | "unknown";

function directionFor(r: OutreachRow): Direction {
  if (r.signal_type === 1) return "new";
  if (r.signal_type === 2) {
    const f = r.fields as Record<string, unknown>;
    const oldP = Number(f?.old_target_pct);
    const newP = Number(f?.new_target_pct);
    if (!Number.isFinite(oldP) || !Number.isFinite(newP)) return "unknown";
    if (newP > oldP) return "increase";
    if (newP < oldP) return "decrease";
    return "unknown";
  }
  if (r.signal_type === 3) {
    const f = r.fields as Record<string, unknown>;
    const prior = Number(f?.prior_year_pacing_usd);
    const next = Number(f?.new_year_pacing_usd);
    if (!Number.isFinite(prior) || !Number.isFinite(next)) return "unknown";
    if (next > prior) return "increase";
    if (next < prior) return "decrease";
    return "unknown";
  }
  return "unknown";
}

function directionBadgeClass(d: Direction): string {
  if (d === "new") return "bg-accent/10 text-accent-hi border-accent/40";
  if (d === "increase") return "bg-green-600/10 text-green-700 border-green-600/40";
  if (d === "decrease") return "bg-red-600/10 text-red-700 border-red-600/40";
  return "bg-bg-subtle text-ink-faint border-line";
}

export function OutreachWorkspace({
  rows,
  planUnfunded,
}: {
  rows: OutreachRow[];
  planUnfunded: PlanUnfundedRow[];
}) {
  const [state, setState, reset] = useUrlFilterState();

  const visibleUnfunded = useMemo(
    () =>
      planUnfunded.filter(
        (p) =>
          p.unfunded_usd >= state.unfundedMin &&
          (state.geographies.length === 0 ||
            state.geographies.includes(p.country)),
      ),
    [planUnfunded, state.unfundedMin, state.geographies],
  );
  const totalUnfunded = useMemo(
    () => visibleUnfunded.reduce((acc, p) => acc + p.unfunded_usd, 0),
    [visibleUnfunded],
  );

  const enriched = useMemo(
    () =>
      rows.map((r) => ({
        ...r,
        _direction: directionFor(r),
      })),
    [rows],
  );

  const assetOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) if (r.asset_class) set.add(r.asset_class);
    return Array.from(set)
      .sort()
      .map((v) => ({ value: v, label: v }));
  }, [rows]);

  const geographyOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) set.add(r.plan.country);
    for (const p of planUnfunded) set.add(p.country);
    return Array.from(set)
      .sort()
      .map((v) => ({ value: v, label: v }));
  }, [rows, planUnfunded]);

  const filtered = useMemo(() => {
    const now = Date.now();
    const dayMs = 86_400_000;
    const days: Record<string, number> = {
      "7": 7,
      "30": 30,
      "60": 60,
      "90": 90,
    };
    const cutoff =
      state.dateRange in days ? now - days[state.dateRange] * dayMs : 0;

    return enriched.filter((r) => {
      if (
        state.assetClasses.length > 0 &&
        (!r.asset_class || !state.assetClasses.includes(r.asset_class))
      )
        return false;
      if (
        state.geographies.length > 0 &&
        !state.geographies.includes(r.plan.country)
      )
        return false;
      if (
        state.directions.length > 0 &&
        !state.directions.includes(r._direction)
      )
        return false;
      if (state.confidenceTiers.length > 0) {
        const t = tierFor(r.confidence, r.priority_score, r.preliminary);
        if (!state.confidenceTiers.includes(t)) return false;
      }
      if (
        state.checkSizeMin > 0 &&
        (r.commitment_amount_usd ?? 0) < state.checkSizeMin
      )
        return false;
      if (
        state.checkSizeMax > 0 &&
        r.commitment_amount_usd != null &&
        r.commitment_amount_usd > state.checkSizeMax
      )
        return false;
      if (cutoff && new Date(r.created_at).getTime() < cutoff) return false;
      return true;
    });
  }, [enriched, state]);

  function exportCsv() {
    const header = [
      "created_at",
      "plan",
      "country",
      "asset_class",
      "type",
      "direction",
      "amount_usd",
      "gp",
      "fund",
      "summary",
      "source_url",
      "priority_score",
      "confidence",
    ];
    const esc = (v: unknown) => {
      if (v == null) return "";
      const s = String(v);
      if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const lines = [header.join(",")];
    for (const r of filtered) {
      const f = r.fields as Record<string, unknown>;
      lines.push(
        [
          r.created_at,
          r.plan.name,
          r.plan.country,
          r.asset_class ?? "",
          r.signal_type === 1 ? "T1" : r.signal_type === 2 ? "T2" : "T3",
          r._direction,
          r.commitment_amount_usd ?? "",
          (f?.gp as string) ?? "",
          (f?.fund_name as string) ?? "",
          r.summary,
          r.document?.source_url ?? "",
          r.priority_score,
          r.confidence,
        ]
          .map(esc)
          .join(","),
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const ts = new Date().toISOString().slice(0, 10);
    a.download = `outreach-${ts}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-3">
      {/* Unfunded budget — by plan, with threshold filter */}
      <section className="card-surface">
        <div className="px-3 py-2.5 border-b border-line flex items-center gap-3 flex-wrap">
          <div className="flex-1 min-w-[180px]">
            <div className="text-[12px] font-medium text-ink">
              Private-markets unfunded budget by plan
            </div>
            <div className="text-[11px] text-ink-faint">
              Σ (target − actual) × AUM across PE/Infra/Credit/RE/VC, latest
              CAFR snapshot per plan.
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10.5px] text-ink-faint uppercase tracking-wide">
              Total
            </div>
            <div className="num tabular-nums text-[14px] font-semibold text-ink leading-none">
              {formatUSD(totalUnfunded)}
            </div>
          </div>
        </div>
        {visibleUnfunded.length === 0 ? (
          <div className="px-4 py-4 text-center text-[12px] text-ink-muted">
            No plans meet the unfunded budget threshold yet. Ingest more
            CAFRs (or lower the threshold) to surface targets.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-line text-ink-faint">
                  <Th>Plan</Th>
                  <Th className="w-[80px]">Country</Th>
                  <Th className="w-[120px]">As of</Th>
                  <Th className="text-right w-[160px]">Unfunded ($)</Th>
                </tr>
              </thead>
              <tbody>
                {visibleUnfunded.map((p) => (
                  <tr
                    key={p.plan_id}
                    className="h-10 border-b border-line last:border-b-0 odd:bg-black/[0.015] dark:odd:bg-white/[0.02] hover:bg-bg-hover transition-colors duration-150"
                  >
                    <td className="px-3 align-middle text-[13px] text-ink">
                      {p.slug ? (
                        <Link
                          href={`/pensions/${p.slug}`}
                          className="hover:text-accent-hi hover:underline"
                        >
                          {p.plan_name}
                        </Link>
                      ) : (
                        p.plan_name
                      )}
                    </td>
                    <td className="px-3 align-middle num text-[12px] text-ink-muted">
                      {p.country}
                    </td>
                    <td className="px-3 align-middle num text-[11.5px] text-ink-muted">
                      {p.as_of_date}
                    </td>
                    <td className="px-3 align-middle text-right num tabular-nums text-[13px] text-ink font-medium">
                      {formatUSD(p.unfunded_usd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Filter bar (URL-synced) */}
      <CombinationFilter
        state={state}
        setState={setState}
        reset={reset}
        config={{
          showAssetClass: true,
          showGeography: true,
          showConfidence: true,
          showDateRange: true,
          showCheckSize: true,
          showUnfunded: true,
          showDirection: true,
        }}
        assetOptions={assetOptions}
        geographyOptions={geographyOptions}
        resultCount={filtered.length}
        rightSlot={
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={exportCsv}
            disabled={filtered.length === 0}
          >
            <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
            Export CSV
          </Button>
        }
      />

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="card-surface p-10 text-center">
          <div className="text-[13px] text-ink-muted">
            No signals match these filters.
          </div>
        </div>
      ) : (
        <div className="card-surface overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-line text-ink-faint">
                  <Th>Date</Th>
                  <Th>Plan</Th>
                  <Th>Asset</Th>
                  <Th>Dir</Th>
                  <Th className="text-right">Amount</Th>
                  <Th>GP → Fund</Th>
                  <Th>Summary</Th>
                  <Th>Source</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const f = r.fields as Record<string, unknown>;
                  const gp = (f?.gp as string) ?? "";
                  const fund = (f?.fund_name as string) ?? "";
                  return (
                    <tr
                      key={r.id}
                      className="h-10 border-b border-line last:border-b-0 odd:bg-black/[0.015] dark:odd:bg-white/[0.02] hover:bg-bg-hover transition-colors duration-150"
                    >
                      <td className="px-3 align-middle">
                        <span className="num tabular-nums text-[11.5px] text-ink-muted">
                          {daysAgo(r.created_at)}
                        </span>
                      </td>
                      <td className="px-3 align-middle">
                        <div className="text-[12.5px] text-ink truncate max-w-[160px]">
                          {r.plan.name}
                        </div>
                        <div className="num text-[10.5px] text-ink-faint">
                          {r.plan.country}
                        </div>
                      </td>
                      <td className="px-3 align-middle">
                        <span className="text-[12.5px] text-ink-muted">
                          {r.asset_class ?? "—"}
                        </span>
                      </td>
                      <td className="px-3 align-middle">
                        <span
                          className={
                            "inline-flex items-center h-5 px-1.5 rounded-sm border text-[11px] " +
                            directionBadgeClass(r._direction)
                          }
                        >
                          {r._direction}
                        </span>
                      </td>
                      <td className="px-3 align-middle text-right">
                        <span className="num tabular-nums text-[12.5px] text-ink">
                          {formatUSD(r.commitment_amount_usd)}
                        </span>
                      </td>
                      <td className="px-3 align-middle">
                        <div className="text-[12.5px] text-ink truncate max-w-[200px]">
                          {gp || "—"}
                        </div>
                        <div className="text-[11px] text-ink-faint truncate max-w-[200px]">
                          {fund}
                        </div>
                      </td>
                      <td className="px-3 align-middle">
                        <div className="text-[12px] text-ink-muted truncate max-w-[360px]">
                          {r.summary}
                        </div>
                      </td>
                      <td className="px-3 align-middle">
                        {r.document?.source_url ? (
                          <a
                            href={r.document.source_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[11.5px] text-accent-hi hover:underline"
                          >
                            link
                          </a>
                        ) : (
                          <Badge variant="seed">—</Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
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
        "text-left font-normal text-[12px] text-ink-faint px-3 h-9 bg-bg-subtle " +
        className
      }
    >
      {children}
    </th>
  );
}
