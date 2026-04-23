"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";
import {
  DEFAULT_FILTER_STATE,
  type ConfidenceTier,
  type FilterState,
} from "./filter-state";

// Serialize / parse helpers. Kept out of filter-state.ts because they import
// Next's app-router hooks which can only run on the client.

const ARRAY_KEYS = new Set([
  "assetClasses",
  "geographies",
  "planIds",
  "confidenceTiers",
  "directions",
]);

function parseArray(v: string | null): string[] {
  if (!v) return [];
  return v
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function parseNumber(v: string | null, fallback: number): number {
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function parseFiltersFromSearch(
  sp: URLSearchParams | null,
): FilterState {
  if (!sp) return { ...DEFAULT_FILTER_STATE };
  return {
    query: sp.get("q") ?? "",
    assetClasses: parseArray(sp.get("ac")),
    geographies: parseArray(sp.get("geo")),
    planIds: parseArray(sp.get("plan")),
    confidenceTiers: parseArray(sp.get("conf")) as ConfidenceTier[],
    dateRange: sp.get("date") ?? "all",
    checkSizeMin: parseNumber(sp.get("csmin"), 0),
    checkSizeMax: parseNumber(sp.get("csmax"), 0),
    unfundedMin: parseNumber(sp.get("umin"), 0),
    minPriority: parseNumber(sp.get("pri"), 0),
    minRelevance: parseNumber(sp.get("rel"), 0),
    directions: parseArray(sp.get("dir")),
  };
}

export function serializeFiltersToParams(s: FilterState): URLSearchParams {
  const p = new URLSearchParams();
  if (s.query.trim()) p.set("q", s.query.trim());
  if (s.assetClasses.length) p.set("ac", s.assetClasses.join(","));
  if (s.geographies.length) p.set("geo", s.geographies.join(","));
  if (s.planIds.length) p.set("plan", s.planIds.join(","));
  if (s.confidenceTiers.length) p.set("conf", s.confidenceTiers.join(","));
  if (s.dateRange && s.dateRange !== "all") p.set("date", s.dateRange);
  if (s.checkSizeMin > 0) p.set("csmin", String(s.checkSizeMin));
  if (s.checkSizeMax > 0) p.set("csmax", String(s.checkSizeMax));
  if (s.unfundedMin > 0) p.set("umin", String(s.unfundedMin));
  if (s.minPriority > 0) p.set("pri", String(s.minPriority));
  if (s.minRelevance > 0) p.set("rel", String(s.minRelevance));
  if (s.directions.length) p.set("dir", s.directions.join(","));
  return p;
}

// Tiny helper: cheap reference equality ok here because filter diffs
// almost always replace arrays/scalars wholesale.
export function useUrlFilterState() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const state = useMemo<FilterState>(
    () => parseFiltersFromSearch(searchParams),
    [searchParams],
  );

  const setState = useCallback(
    (next: FilterState | ((prev: FilterState) => FilterState)) => {
      const resolved =
        typeof next === "function" ? next(state) : next;
      const qs = serializeFiltersToParams(resolved).toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, state],
  );

  const reset = useCallback(() => {
    router.replace(pathname, { scroll: false });
  }, [router, pathname]);

  return [state, setState, reset] as const;
}

// Convenience: ignore each key without enumerating. Used when a page wants to
// preserve *some* non-filter query params while clearing filter keys.
export function stripFilterKeys(sp: URLSearchParams): URLSearchParams {
  const keep = new URLSearchParams();
  for (const [k, v] of sp.entries()) {
    if (
      k === "q" ||
      k === "ac" ||
      k === "geo" ||
      k === "plan" ||
      k === "conf" ||
      k === "date" ||
      k === "csmin" ||
      k === "csmax" ||
      k === "umin" ||
      k === "pri" ||
      k === "rel" ||
      k === "dir"
    ) {
      continue;
    }
    keep.append(k, v);
  }
  // Ensures ARRAY_KEYS import is retained if later referenced.
  void ARRAY_KEYS;
  return keep;
}
