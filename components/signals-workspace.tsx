"use client";

import { useMemo, useState } from "react";
import { SignalTable } from "@/components/signal-table";
import { SignalDetailPanel } from "@/components/signal-detail-panel";
import { CombinationFilter } from "@/components/filters/combination-filter";
import { useUrlFilterState } from "@/components/filters/use-url-filter-state";
import { tierFor } from "@/components/filters/filter-state";
import { SavedViewsMenu } from "@/components/filters/saved-views-menu";
import type { SignalWithPlan } from "@/lib/types";

export type SignalWithDoc = SignalWithPlan & {
  document: {
    id: string;
    source_url: string;
    meeting_date: string | null;
  } | null;
  relevance_score?: number;
};

export function SignalsWorkspace({ rows }: { rows: SignalWithDoc[] }) {
  const [state, setState, reset] = useUrlFilterState();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const planOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows) map.set(r.plan.id, r.plan.name);
    return Array.from(map, ([value, label]) => ({ value, label })).sort(
      (a, b) => a.label.localeCompare(b.label),
    );
  }, [rows]);

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
    return Array.from(set)
      .sort()
      .map((v) => ({ value: v, label: v }));
  }, [rows]);

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
    const q = state.query.trim().toLowerCase();

    return rows.filter((r) => {
      if (
        state.assetClasses.length > 0 &&
        (!r.asset_class || !state.assetClasses.includes(r.asset_class))
      )
        return false;
      if (
        state.planIds.length > 0 &&
        !state.planIds.includes(r.plan.id)
      )
        return false;
      if (
        state.geographies.length > 0 &&
        !state.geographies.includes(r.plan.country)
      )
        return false;
      if (r.priority_score < state.minPriority) return false;
      if ((r.relevance_score ?? 0) < state.minRelevance) return false;
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
      if (q) {
        const hay = [
          r.summary,
          r.plan.name,
          r.asset_class ?? "",
          JSON.stringify(r.fields ?? {}),
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, state]);

  const selected = useMemo(
    () => filtered.find((r) => r.id === selectedId) ?? null,
    [filtered, selectedId],
  );

  return (
    <div className="space-y-3">
      <CombinationFilter
        state={state}
        setState={setState}
        reset={reset}
        config={{
          showQuery: true,
          showAssetClass: true,
          showPlan: true,
          showGeography: true,
          showConfidence: true,
          showDateRange: true,
          showCheckSize: true,
          showPriority: true,
          showRelevance: true,
        }}
        assetOptions={assetOptions}
        geographyOptions={geographyOptions}
        planOptions={planOptions}
        resultCount={filtered.length}
        rightSlot={
          <SavedViewsMenu page="signals" state={state} onApply={setState} />
        }
      />
      <div className="flex gap-3 items-stretch">
        <div className="flex-1 min-w-0">
          <SignalTable
            rows={filtered}
            onSelect={setSelectedId}
            selectedId={selectedId}
          />
        </div>
        <div className="w-[400px] shrink-0 hidden lg:block">
          <SignalDetailPanel signal={selected} />
        </div>
      </div>
    </div>
  );
}
