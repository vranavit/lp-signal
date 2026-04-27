"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

// URL-synced filter state for /explore. Sibling to components/filters/use-url-filter-state.ts
// but with explore-specific keys (approval types, GP/fund free-text, time presets that include
// 6mo / 12mo / custom range). Intentionally not folded into the shared FilterState type to keep
// /signals and /outreach unchanged.

export type TimePreset = "30d" | "60d" | "6mo" | "12mo" | "all" | "custom";

// Sortable columns. Keep narrow so column-header click handlers can use string literals.
export type SortColumn = "plan" | "date" | "gp" | "fund" | "amount" | "asset" | "type";
export type SortDir = "asc" | "desc";

export type ExploreFilterState = {
  assetClasses: string[];
  planIds: string[];
  approvalTypes: string[]; // includes "(other)" for null/unknown
  timePreset: TimePreset;
  fromDate: string | null; // YYYY-MM-DD, only used when timePreset = "custom"
  toDate: string | null;
  minAmount: number; // USD integer; 0 = no min
  maxAmount: number; // USD integer; 0 = no max
  query: string; // free-text search across gp + fund_name
  sort: SortColumn;
  dir: SortDir;
  page: number; // 1-indexed
};

export const DEFAULT_EXPLORE_STATE: ExploreFilterState = {
  assetClasses: [],
  planIds: [],
  approvalTypes: [],
  // Per spec refinement #5: default time window is "last 12 months" (filters historical noise).
  // URL stays clean when on default: t=12mo is omitted from the URL string.
  timePreset: "12mo",
  fromDate: null,
  toDate: null,
  minAmount: 0,
  maxAmount: 0,
  query: "",
  sort: "date",
  dir: "desc",
  page: 1,
};

function parseArr(v: string | null): string[] {
  if (!v) return [];
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}

function parseInt0(v: string | null, fallback: number): number {
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : fallback;
}

const VALID_PRESET = new Set<TimePreset>(["30d", "60d", "6mo", "12mo", "all", "custom"]);
const VALID_SORT = new Set<SortColumn>(["plan", "date", "gp", "fund", "amount", "asset", "type"]);

export function parseExploreFilters(sp: URLSearchParams | null): ExploreFilterState {
  if (!sp) return { ...DEFAULT_EXPLORE_STATE };
  const presetRaw = sp.get("t") ?? DEFAULT_EXPLORE_STATE.timePreset;
  const preset = (VALID_PRESET.has(presetRaw as TimePreset) ? presetRaw : DEFAULT_EXPLORE_STATE.timePreset) as TimePreset;
  const sortRaw = sp.get("sort") ?? DEFAULT_EXPLORE_STATE.sort;
  const sort = (VALID_SORT.has(sortRaw as SortColumn) ? sortRaw : DEFAULT_EXPLORE_STATE.sort) as SortColumn;
  const dirRaw = sp.get("dir");
  const dir: SortDir = dirRaw === "asc" ? "asc" : "desc";
  return {
    assetClasses: parseArr(sp.get("ac")),
    planIds: parseArr(sp.get("plan")),
    approvalTypes: parseArr(sp.get("type")),
    timePreset: preset,
    fromDate: sp.get("from"),
    toDate: sp.get("to"),
    minAmount: parseInt0(sp.get("min"), 0),
    maxAmount: parseInt0(sp.get("max"), 0),
    query: sp.get("q") ?? "",
    sort,
    dir,
    page: Math.max(1, parseInt0(sp.get("page"), 1)),
  };
}

export function serializeExploreFilters(s: ExploreFilterState): URLSearchParams {
  const p = new URLSearchParams();
  if (s.assetClasses.length) p.set("ac", s.assetClasses.join(","));
  if (s.planIds.length) p.set("plan", s.planIds.join(","));
  if (s.approvalTypes.length) p.set("type", s.approvalTypes.join(","));
  if (s.timePreset !== DEFAULT_EXPLORE_STATE.timePreset) p.set("t", s.timePreset);
  if (s.timePreset === "custom" && s.fromDate) p.set("from", s.fromDate);
  if (s.timePreset === "custom" && s.toDate) p.set("to", s.toDate);
  if (s.minAmount > 0) p.set("min", String(s.minAmount));
  if (s.maxAmount > 0) p.set("max", String(s.maxAmount));
  if (s.query.trim()) p.set("q", s.query.trim());
  if (s.sort !== DEFAULT_EXPLORE_STATE.sort) p.set("sort", s.sort);
  if (s.dir !== DEFAULT_EXPLORE_STATE.dir) p.set("dir", s.dir);
  if (s.page > 1) p.set("page", String(s.page));
  return p;
}

const FILTER_KEYS_THAT_RESET_PAGE: Array<keyof ExploreFilterState> = [
  "assetClasses",
  "planIds",
  "approvalTypes",
  "timePreset",
  "fromDate",
  "toDate",
  "minAmount",
  "maxAmount",
  "query",
];

// Returns true if the next state changes any filter (not pagination or sort).
function filtersChanged(prev: ExploreFilterState, next: ExploreFilterState): boolean {
  for (const k of FILTER_KEYS_THAT_RESET_PAGE) {
    const a = prev[k];
    const b = next[k];
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length || a.some((v, i) => v !== b[i])) return true;
    } else if (a !== b) {
      return true;
    }
  }
  return false;
}

export function useExploreFilterState() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const state = useMemo<ExploreFilterState>(
    () => parseExploreFilters(searchParams),
    [searchParams],
  );

  const setState = useCallback(
    (next: ExploreFilterState | ((prev: ExploreFilterState) => ExploreFilterState)) => {
      const resolved = typeof next === "function" ? next(state) : next;
      // Per spec refinement #5: resetting page to 1 whenever any filter changes.
      // Sort changes don't reset page since they preserve the result set.
      const adjusted: ExploreFilterState = filtersChanged(state, resolved)
        ? { ...resolved, page: 1 }
        : resolved;
      const qs = serializeExploreFilters(adjusted).toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, state],
  );

  const reset = useCallback(() => {
    router.replace(pathname, { scroll: false });
  }, [router, pathname]);

  return [state, setState, reset] as const;
}
