"use client";

import { useMemo, useState } from "react";
import { SignalTable } from "@/components/signal-table";
import {
  SignalFilterBar,
  type FilterState,
} from "@/components/signal-filter-bar";
import { SignalDetailPanel } from "@/components/signal-detail-panel";
import type { SignalWithPlan } from "@/lib/types";

export type SignalWithDoc = SignalWithPlan & {
  document: {
    id: string;
    source_url: string;
    meeting_date: string | null;
  } | null;
};

const DEFAULT_STATE: FilterState = {
  query: "",
  assetClass: "all",
  planId: "all",
  dateRange: "30",
  minPriority: 0,
};

export function SignalsWorkspace({ rows }: { rows: SignalWithDoc[] }) {
  const [state, setState] = useState<FilterState>(DEFAULT_STATE);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const planOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows) map.set(r.plan.id, r.plan.name);
    return Array.from(map, ([value, label]) => ({ value, label })).sort((a, b) =>
      a.label.localeCompare(b.label),
    );
  }, [rows]);

  const assetOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) if (r.asset_class) set.add(r.asset_class);
    return Array.from(set)
      .sort()
      .map((v) => ({ value: v, label: v }));
  }, [rows]);

  const filtered = useMemo(() => {
    const now = Date.now();
    const dayMs = 86_400_000;
    const days: Record<string, number> = { "7": 7, "30": 30, "90": 90 };
    const cutoff =
      state.dateRange in days ? now - days[state.dateRange] * dayMs : 0;
    const q = state.query.trim().toLowerCase();

    return rows.filter((r) => {
      if (state.assetClass !== "all" && r.asset_class !== state.assetClass)
        return false;
      if (state.planId !== "all" && r.plan.id !== state.planId) return false;
      if (r.priority_score < state.minPriority) return false;
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
      <SignalFilterBar
        state={state}
        setState={setState}
        planOptions={planOptions}
        assetOptions={assetOptions}
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
