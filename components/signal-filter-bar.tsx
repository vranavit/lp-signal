"use client";

import { ChevronDown, Search } from "lucide-react";

type Option = { value: string; label: string };

export type FilterState = {
  query: string;
  assetClass: string;
  planId: string;
  dateRange: string;
  minPriority: number;
};

export function SignalFilterBar({
  state,
  setState,
  planOptions,
  assetOptions,
}: {
  state: FilterState;
  setState: (fn: (s: FilterState) => FilterState) => void;
  planOptions: Option[];
  assetOptions: Option[];
}) {
  return (
    <div className="card-surface flex flex-wrap items-center gap-2 px-2.5 py-2">
      <div className="relative flex-1 min-w-[240px]">
        <Search
          className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-faint pointer-events-none"
          strokeWidth={1.75}
        />
        <input
          type="text"
          value={state.query}
          onChange={(e) => setState((s) => ({ ...s, query: e.target.value }))}
          placeholder="Search signals, plans, or managers"
          className="h-8 w-full pl-8 pr-2.5 text-[13px] bg-bg border border-line rounded-sm text-ink placeholder:text-ink-dim focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-colors duration-150"
        />
      </div>

      <FilterSelect
        value={state.assetClass}
        onChange={(v) => setState((s) => ({ ...s, assetClass: v }))}
        options={[{ value: "all", label: "All asset classes" }, ...assetOptions]}
      />
      <FilterSelect
        value={state.planId}
        onChange={(v) => setState((s) => ({ ...s, planId: v }))}
        options={[{ value: "all", label: "All plans" }, ...planOptions]}
      />
      <FilterSelect
        value={state.dateRange}
        onChange={(v) => setState((s) => ({ ...s, dateRange: v }))}
        options={[
          { value: "7", label: "Last 7 days" },
          { value: "30", label: "Last 30 days" },
          { value: "90", label: "Last 90 days" },
          { value: "all", label: "All time" },
        ]}
      />

      <div className="flex items-center gap-2 h-8 pl-3 pr-1 border-l border-line ml-0.5">
        <span className="text-[12px] text-ink-muted whitespace-nowrap">
          Priority ≥
        </span>
        <input
          type="range"
          min={0}
          max={100}
          value={state.minPriority}
          onChange={(e) =>
            setState((s) => ({ ...s, minPriority: Number(e.target.value) }))
          }
          className="w-24 accent-accent cursor-pointer"
          aria-label="Minimum priority score"
        />
        <span className="num tabular-nums text-[12px] text-ink font-medium w-6 text-right">
          {state.minPriority}
        </span>
      </div>
    </div>
  );
}

function FilterSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Option[];
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 pl-2.5 pr-7 text-[13px] bg-bg border border-line rounded-sm appearance-none cursor-pointer text-ink hover:border-line-strong focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-colors duration-150"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown
        className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-faint pointer-events-none"
        strokeWidth={1.75}
      />
    </div>
  );
}
