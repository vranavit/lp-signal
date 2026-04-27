"use client";

import { useMemo, useState } from "react";
import { ExploreFilters } from "./explore-filters";
import { ExploreStatsStrip } from "./explore-stats";
import { ExploreSidePanel, type SidePanelKind } from "./explore-side-panel";
import { ExploreTable } from "./explore-table";
import { useExploreFilterState } from "./use-explore-filter-state";
import {
  APPROVAL_TYPE_OTHER,
  fieldStr,
  type ExplorePlan,
  type ExploreSignal,
} from "./explore-types";

// Map a time-preset to its UTC cutoff timestamp. "all" returns null (no cutoff).
function presetCutoffMs(
  preset: string,
  fromDate: string | null,
): { from: number | null; to: number | null } {
  const now = Date.now();
  const day = 86_400_000;
  switch (preset) {
    case "30d":
      return { from: now - 30 * day, to: null };
    case "60d":
      return { from: now - 60 * day, to: null };
    case "6mo":
      return { from: now - 182 * day, to: null };
    case "12mo":
      return { from: now - 365 * day, to: null };
    case "custom": {
      const fromMs = fromDate ? Date.parse(fromDate) : null;
      return {
        from: Number.isFinite(fromMs as number) ? (fromMs as number) : null,
        to: null,
      };
    }
    default:
      return { from: null, to: null };
  }
}

function approvalTypeKey(s: ExploreSignal): string {
  const t = fieldStr(s, "approval_type");
  if (!t) return APPROVAL_TYPE_OTHER;
  return t;
}

function approvalDateMs(s: ExploreSignal): number | null {
  const ad = fieldStr(s, "approval_date");
  if (!ad) return null;
  const ms = Date.parse(ad);
  return Number.isFinite(ms) ? ms : null;
}

export function ExploreWorkspace({
  signals,
  plans,
}: {
  signals: ExploreSignal[];
  plans: ExplorePlan[];
}) {
  const [state, setState, reset] = useExploreFilterState();
  const [sidePanel, setSidePanel] = useState<SidePanelKind | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const assetOptions = useMemo(() => {
    const set = new Set<string>();
    for (const s of signals) {
      const v = fieldStr(s, "asset_class");
      if (v) set.add(v);
    }
    return Array.from(set).sort();
  }, [signals]);

  const approvalTypeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const s of signals) set.add(approvalTypeKey(s));
    return Array.from(set).sort();
  }, [signals]);

  const customFromTo = useMemo(() => {
    if (state.timePreset !== "custom") return { from: null, to: null };
    const fromMs = state.fromDate ? Date.parse(state.fromDate) : null;
    const toMs = state.toDate ? Date.parse(state.toDate) + 86_400_000 - 1 : null;
    return {
      from: Number.isFinite(fromMs as number) ? (fromMs as number) : null,
      to: Number.isFinite(toMs as number) ? (toMs as number) : null,
    };
  }, [state.timePreset, state.fromDate, state.toDate]);

  // Apply each filter independently so we can compute "least restrictive
  // remove" for the empty-state hint.
  const filterPredicates = useMemo(() => {
    const cutoff = presetCutoffMs(state.timePreset, state.fromDate);
    const fromMs = state.timePreset === "custom" ? customFromTo.from : cutoff.from;
    const toMs = state.timePreset === "custom" ? customFromTo.to : cutoff.to;
    const q = state.query.trim().toLowerCase();
    const minA = state.minAmount;
    const maxA = state.maxAmount;
    return {
      assetClass: (s: ExploreSignal) => {
        if (state.assetClasses.length === 0) return true;
        const ac = fieldStr(s, "asset_class");
        return state.assetClasses.includes(ac);
      },
      plan: (s: ExploreSignal) => {
        if (state.planIds.length === 0) return true;
        return state.planIds.includes(s.plan_id);
      },
      approvalType: (s: ExploreSignal) => {
        if (state.approvalTypes.length === 0) return true;
        return state.approvalTypes.includes(approvalTypeKey(s));
      },
      time: (s: ExploreSignal) => {
        if (fromMs === null && toMs === null) return true;
        const ad = approvalDateMs(s);
        if (ad === null) return false; // exclude rows without approval_date when a time filter is on
        if (fromMs !== null && ad < fromMs) return false;
        if (toMs !== null && ad > toMs) return false;
        return true;
      },
      amount: (s: ExploreSignal) => {
        if (minA === 0 && maxA === 0) return true;
        const a = s.commitment_amount_usd ?? 0;
        if (minA > 0 && a < minA) return false;
        if (maxA > 0 && a > maxA) return false;
        return true;
      },
      query: (s: ExploreSignal) => {
        if (!q) return true;
        const gp = fieldStr(s, "gp").toLowerCase();
        const fund = fieldStr(s, "fund_name").toLowerCase();
        return gp.includes(q) || fund.includes(q);
      },
    };
  }, [state, customFromTo]);

  type FilterKey = keyof typeof filterPredicates;
  const FILTER_KEYS: FilterKey[] = [
    "assetClass",
    "plan",
    "approvalType",
    "time",
    "amount",
    "query",
  ];

  const filtered = useMemo(() => {
    return signals.filter((s) => {
      for (const k of FILTER_KEYS) {
        if (!filterPredicates[k](s)) return false;
      }
      return true;
    });
  }, [signals, filterPredicates]);

  // Empty-state hint: which single filter, if dropped, yields the most rows?
  // Returns null if no filters are active.
  const emptyHint = useMemo(() => {
    if (filtered.length > 0) return null;
    const activeKeys = FILTER_KEYS.filter((k) => {
      // A filter "is active" if its predicate excludes any rows from the
      // full signal set. Cheaper proxy: state values that aren't defaults.
      switch (k) {
        case "assetClass":
          return state.assetClasses.length > 0;
        case "plan":
          return state.planIds.length > 0;
        case "approvalType":
          return state.approvalTypes.length > 0;
        case "time":
          return state.timePreset !== "all";
        case "amount":
          return state.minAmount > 0 || state.maxAmount > 0;
        case "query":
          return state.query.trim().length > 0;
      }
    });
    if (activeKeys.length === 0) return null;
    let best: { key: FilterKey; matches: number } | null = null;
    for (const drop of activeKeys) {
      let matches = 0;
      for (const s of signals) {
        let ok = true;
        for (const k of FILTER_KEYS) {
          if (k === drop) continue;
          if (!filterPredicates[k](s)) {
            ok = false;
            break;
          }
        }
        if (ok) matches++;
      }
      if (!best || matches > best.matches) best = { key: drop, matches };
    }
    if (!best) return null;
    const labels: Record<FilterKey, string> = {
      assetClass: "Asset class",
      plan: "Plan",
      approvalType: "Approval type",
      time: "Time window",
      amount: "Commitment size",
      query: "GP/Fund search",
    };
    return { droppedFilter: labels[best.key], matchCount: best.matches };
  }, [filtered.length, signals, filterPredicates, state]);

  // Sort.
  const sorted = useMemo(() => {
    const list = [...filtered];
    const dir = state.dir === "asc" ? 1 : -1;
    const cmp = (a: ExploreSignal, b: ExploreSignal): number => {
      const planA = a.plan?.name ?? "";
      const planB = b.plan?.name ?? "";
      const dateA = approvalDateMs(a);
      const dateB = approvalDateMs(b);
      const gpA = fieldStr(a, "gp");
      const gpB = fieldStr(b, "gp");
      const fundA = fieldStr(a, "fund_name");
      const fundB = fieldStr(b, "fund_name");
      const amtA = a.commitment_amount_usd ?? 0;
      const amtB = b.commitment_amount_usd ?? 0;
      const acA = fieldStr(a, "asset_class");
      const acB = fieldStr(b, "asset_class");
      const tyA = approvalTypeKey(a);
      const tyB = approvalTypeKey(b);
      const cmpVal = ((): number => {
        switch (state.sort) {
          case "plan":
            return planA.localeCompare(planB);
          case "date":
            // Nulls sink to bottom regardless of direction.
            if (dateA === null && dateB === null) return 0;
            if (dateA === null) return 1;
            if (dateB === null) return -1;
            return (dateA - dateB) * dir;
          case "gp":
            return gpA.localeCompare(gpB) * dir;
          case "fund":
            return fundA.localeCompare(fundB) * dir;
          case "amount":
            return (amtA - amtB) * dir;
          case "asset":
            return acA.localeCompare(acB) * dir;
          case "type":
            return tyA.localeCompare(tyB) * dir;
        }
      })();
      // For date column the dir multiplier is applied above; for other columns
      // we already applied dir. Avoid double-applying for date.
      const finalCmp = state.sort === "date" ? cmpVal : cmpVal;
      // Tiebreak by id for determinism.
      return finalCmp !== 0 ? finalCmp : a.id.localeCompare(b.id);
    };
    list.sort(cmp);
    return list;
  }, [filtered, state.sort, state.dir]);

  // Pagination.
  const PAGE_SIZE = 25;
  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(state.page, pageCount);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const pageRows = sorted.slice(pageStart, pageStart + PAGE_SIZE);

  // Stats.
  const stats = useMemo(() => {
    const totalUsd = filtered.reduce(
      (acc, s) => acc + (s.commitment_amount_usd ?? 0),
      0,
    );
    const gps = new Set<string>();
    for (const s of filtered) {
      const gp = fieldStr(s, "gp").trim();
      if (gp) gps.add(gp);
    }
    const planIds = new Set<string>();
    for (const s of filtered) planIds.add(s.plan_id);
    return {
      commitments: filtered.length,
      totalUsd,
      gpCount: gps.size,
      planCount: planIds.size,
    };
  }, [filtered]);

  return (
    <div className="space-y-3">
      <ExploreFilters
        state={state}
        setState={setState}
        reset={reset}
        plans={plans}
        assetOptions={assetOptions}
        approvalTypeOptions={approvalTypeOptions}
      />

      <ExploreStatsStrip
        commitments={stats.commitments}
        totalUsd={stats.totalUsd}
        gpCount={stats.gpCount}
        planCount={stats.planCount}
        onOpenGps={() => setSidePanel("gps")}
        onOpenPlans={() => setSidePanel("plans")}
      />

      <ExploreTable
        rows={pageRows}
        totalRowCount={sorted.length}
        sortColumn={state.sort}
        sortDir={state.dir}
        page={safePage}
        pageCount={pageCount}
        pageSize={PAGE_SIZE}
        expandedId={expandedId}
        emptyHint={emptyHint}
        onChangeSort={(col) => {
          setState((s) => {
            // Three-state click: same col + desc -> asc; same col + asc -> reset
            // to default; new col -> desc.
            if (s.sort === col && s.dir === "desc") return { ...s, dir: "asc" };
            if (s.sort === col && s.dir === "asc")
              return { ...s, sort: "date", dir: "desc" };
            return { ...s, sort: col, dir: "desc" };
          });
        }}
        onChangePage={(p) => setState((s) => ({ ...s, page: p }))}
        onToggleExpand={(id) =>
          setExpandedId((prev) => (prev === id ? null : id))
        }
        onResetFilters={reset}
      />

      {sidePanel ? (
        <ExploreSidePanel
          kind={sidePanel}
          rows={filtered}
          plans={plans}
          onClose={() => setSidePanel(null)}
        />
      ) : null}
    </div>
  );
}
