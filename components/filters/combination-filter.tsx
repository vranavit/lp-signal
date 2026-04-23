"use client";

import * as React from "react";
import { ChevronDown, Search, X } from "lucide-react";
import {
  activeFilterCount,
  CHECK_SIZE_STOPS,
  DEFAULT_FILTER_STATE,
  labelUsd,
  UNFUNDED_STOPS,
  type ConfidenceTier,
  type FilterState,
} from "./filter-state";

type Option = { value: string; label: string; hint?: string };

export type CombinationFilterConfig = {
  showQuery?: boolean;
  showAssetClass?: boolean;
  showGeography?: boolean;
  showPlan?: boolean;
  showConfidence?: boolean;
  showDateRange?: boolean;
  showCheckSize?: boolean;
  showUnfunded?: boolean;
  showPriority?: boolean;
  showRelevance?: boolean;
  showDirection?: boolean;
};

export function CombinationFilter({
  state,
  setState,
  reset,
  config,
  assetOptions,
  geographyOptions,
  planOptions,
  rightSlot,
  resultCount,
}: {
  state: FilterState;
  setState: (next: FilterState | ((prev: FilterState) => FilterState)) => void;
  reset: () => void;
  config: CombinationFilterConfig;
  assetOptions?: Option[];
  geographyOptions?: Option[];
  planOptions?: Option[];
  rightSlot?: React.ReactNode;
  resultCount?: number;
}) {
  const count = activeFilterCount(state);

  return (
    <div className="space-y-2">
      <div className="card-surface flex flex-wrap items-center gap-2 px-2.5 py-2">
        {config.showQuery ? (
          <div className="relative flex-1 min-w-[220px]">
            <Search
              className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-faint pointer-events-none"
              strokeWidth={1.75}
            />
            <input
              type="text"
              value={state.query}
              onChange={(e) =>
                setState((s) => ({ ...s, query: e.target.value }))
              }
              placeholder="Search signals, plans, or managers"
              className="h-8 w-full pl-8 pr-2.5 text-[13px] bg-bg border border-line rounded-sm text-ink placeholder:text-ink-dim focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-colors duration-150"
            />
          </div>
        ) : null}

        {config.showAssetClass ? (
          <MultiSelect
            label="Asset class"
            value={state.assetClasses}
            onChange={(v) =>
              setState((s) => ({ ...s, assetClasses: v }))
            }
            options={assetOptions ?? []}
          />
        ) : null}

        {config.showGeography ? (
          <MultiSelect
            label="Geography"
            value={state.geographies}
            onChange={(v) =>
              setState((s) => ({ ...s, geographies: v }))
            }
            options={geographyOptions ?? []}
          />
        ) : null}

        {config.showPlan ? (
          <MultiSelect
            label="Plan"
            value={state.planIds}
            onChange={(v) => setState((s) => ({ ...s, planIds: v }))}
            options={planOptions ?? []}
            width="w-[220px]"
          />
        ) : null}

        {config.showConfidence ? (
          <MultiSelect
            label="Confidence"
            value={state.confidenceTiers}
            onChange={(v) =>
              setState((s) => ({
                ...s,
                confidenceTiers: v as ConfidenceTier[],
              }))
            }
            options={[
              {
                value: "accepted",
                label: "Accepted",
                hint: "conf ≥ 0.85 · priority ≥ 40",
              },
              {
                value: "preliminary",
                label: "Preliminary",
                hint: "conf 0.70–0.85 or flagged",
              },
              {
                value: "review",
                label: "Review",
                hint: "conf < 0.70",
              },
            ]}
          />
        ) : null}

        {config.showDateRange ? (
          <SingleSelect
            value={state.dateRange}
            onChange={(v) => setState((s) => ({ ...s, dateRange: v }))}
            options={[
              { value: "7", label: "Last 7 days" },
              { value: "30", label: "Last 30 days" },
              { value: "60", label: "Last 60 days" },
              { value: "90", label: "Last 90 days" },
              { value: "all", label: "All time" },
            ]}
          />
        ) : null}

        {config.showDirection ? (
          <MultiSelect
            label="Direction"
            value={state.directions}
            onChange={(v) => setState((s) => ({ ...s, directions: v }))}
            options={[
              { value: "new", label: "New commitment" },
              { value: "increase", label: "Increase" },
              { value: "decrease", label: "Decrease" },
            ]}
          />
        ) : null}

        {config.showCheckSize ? (
          <RangeSelect
            label="Check size"
            min={state.checkSizeMin}
            max={state.checkSizeMax}
            stops={CHECK_SIZE_STOPS}
            onChange={(min, max) =>
              setState((s) => ({
                ...s,
                checkSizeMin: min,
                checkSizeMax: max,
              }))
            }
          />
        ) : null}

        {config.showUnfunded ? (
          <RangeSelect
            label="Unfunded ≥"
            min={state.unfundedMin}
            max={0}
            stops={UNFUNDED_STOPS}
            singleMin
            onChange={(min) =>
              setState((s) => ({ ...s, unfundedMin: min }))
            }
          />
        ) : null}

        {config.showPriority ? (
          <InlineRange
            label="Priority ≥"
            value={state.minPriority}
            onChange={(v) =>
              setState((s) => ({ ...s, minPriority: v }))
            }
            max={100}
          />
        ) : null}

        {config.showRelevance ? (
          <InlineRange
            label="Relevance ≥"
            value={state.minRelevance}
            onChange={(v) =>
              setState((s) => ({ ...s, minRelevance: v }))
            }
            max={100}
            step={5}
          />
        ) : null}

        <div className="flex-1" />

        {typeof resultCount === "number" ? (
          <span className="num tabular-nums text-[12px] text-ink-muted">
            {resultCount} rows
          </span>
        ) : null}

        {count > 0 ? (
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-1.5 h-8 px-2.5 text-[12px] border border-line rounded-sm hover:border-line-strong text-ink-muted hover:text-ink transition-colors duration-150 cursor-pointer"
          >
            <span className="font-mono tabular-nums text-[11px] bg-bg-panel border border-line rounded-sm px-1">
              {count}
            </span>
            <span>Clear all</span>
            <X className="h-3 w-3" strokeWidth={2} />
          </button>
        ) : null}

        {rightSlot}
      </div>

      {count > 0 ? <ChipRow state={state} setState={setState} /> : null}
    </div>
  );
}

// ── Multi-select dropdown ─────────────────────────────────────────────────

function MultiSelect({
  label,
  value,
  onChange,
  options,
  width = "w-[200px]",
}: {
  label: string;
  value: string[];
  onChange: (v: string[]) => void;
  options: Option[];
  width?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement | null>(null);
  useOutsideClick(ref, () => setOpen(false));

  const selected = value;
  const isAll = selected.length === 0;
  const summary = isAll
    ? `All ${label.toLowerCase()}`
    : selected.length === 1
    ? options.find((o) => o.value === selected[0])?.label ?? selected[0]
    : `${selected.length} selected`;

  function toggle(v: string) {
    if (selected.includes(v)) {
      onChange(selected.filter((x) => x !== v));
    } else {
      onChange([...selected, v]);
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((x) => !x)}
        className={
          "h-8 pl-2.5 pr-2 text-[13px] bg-bg border border-line rounded-sm inline-flex items-center gap-2 cursor-pointer hover:border-line-strong " +
          (selected.length > 0
            ? "text-ink"
            : "text-ink-muted") +
          " focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
        }
      >
        <span className="truncate max-w-[160px]">{summary}</span>
        {selected.length > 0 ? (
          <span className="font-mono tabular-nums text-[10.5px] bg-accent/10 text-accent-hi border border-accent/30 rounded-sm px-1">
            {selected.length}
          </span>
        ) : null}
        <ChevronDown className="h-3.5 w-3.5 text-ink-faint" strokeWidth={1.75} />
      </button>
      {open ? (
        <div
          className={
            "absolute z-30 mt-1 p-1 bg-bg-subtle border border-line rounded-sm shadow-lg " +
            width
          }
        >
          <div className="max-h-64 overflow-y-auto">
            {options.length === 0 ? (
              <div className="px-2 py-1.5 text-[12px] text-ink-faint">
                No options.
              </div>
            ) : (
              options.map((o) => {
                const on = selected.includes(o.value);
                return (
                  <button
                    type="button"
                    key={o.value}
                    onClick={() => toggle(o.value)}
                    className={
                      "w-full text-left px-2 py-1.5 rounded-sm text-[13px] flex items-center gap-2 hover:bg-bg-hover cursor-pointer " +
                      (on ? "text-ink" : "text-ink-muted")
                    }
                  >
                    <span
                      aria-hidden
                      className={
                        "inline-flex items-center justify-center h-3.5 w-3.5 border rounded-[2px] " +
                        (on
                          ? "bg-accent border-accent text-white"
                          : "border-line")
                      }
                    >
                      {on ? (
                        <svg viewBox="0 0 10 10" className="h-2.5 w-2.5">
                          <path
                            d="M2 5 L4 7 L8 3"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            fill="none"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      ) : null}
                    </span>
                    <span className="flex-1 truncate">{o.label}</span>
                    {o.hint ? (
                      <span className="font-mono text-[10px] text-ink-faint">
                        {o.hint}
                      </span>
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
          {selected.length > 0 ? (
            <div className="px-2 pt-1.5 pb-1 border-t border-line mt-1">
              <button
                type="button"
                onClick={() => onChange([])}
                className="text-[11.5px] text-ink-muted hover:text-ink cursor-pointer"
              >
                Clear {label.toLowerCase()}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ── Single-select dropdown (date range) ───────────────────────────────────

function SingleSelect({
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

// ── Range dropdown (check size, unfunded) ─────────────────────────────────

function RangeSelect({
  label,
  min,
  max,
  stops,
  onChange,
  singleMin = false,
}: {
  label: string;
  min: number;
  max: number;
  stops: number[];
  onChange: (min: number, max: number) => void;
  singleMin?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement | null>(null);
  useOutsideClick(ref, () => setOpen(false));

  const active = min > 0 || (!singleMin && max > 0);
  const summary = !active
    ? `Any ${label.toLowerCase()}`
    : singleMin
    ? `${label} ${labelUsd(min)}`
    : `${labelUsd(min)} – ${max > 0 ? labelUsd(max) : "max"}`;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((x) => !x)}
        className={
          "h-8 pl-2.5 pr-2 text-[13px] bg-bg border border-line rounded-sm inline-flex items-center gap-2 cursor-pointer hover:border-line-strong focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 " +
          (active ? "text-ink" : "text-ink-muted")
        }
      >
        <span className="truncate max-w-[180px]">{summary}</span>
        <ChevronDown className="h-3.5 w-3.5 text-ink-faint" strokeWidth={1.75} />
      </button>
      {open ? (
        <div className="absolute z-30 mt-1 p-3 bg-bg-subtle border border-line rounded-sm shadow-lg w-[260px]">
          <div className="text-[11px] uppercase text-ink-faint mb-2 tracking-wide">
            {label}
          </div>
          <div className="space-y-3">
            <RangeStopRow
              heading={singleMin ? "Threshold" : "Minimum"}
              value={min}
              stops={stops}
              onChange={(v) => onChange(v, max)}
            />
            {!singleMin ? (
              <RangeStopRow
                heading="Maximum"
                value={max}
                stops={stops}
                onChange={(v) => onChange(min, v)}
              />
            ) : null}
          </div>
          {active ? (
            <div className="pt-2 mt-3 border-t border-line">
              <button
                type="button"
                onClick={() => onChange(0, 0)}
                className="text-[11.5px] text-ink-muted hover:text-ink cursor-pointer"
              >
                Clear {label.toLowerCase()}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function RangeStopRow({
  heading,
  value,
  stops,
  onChange,
}: {
  heading: string;
  value: number;
  stops: number[];
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="text-[11px] text-ink-faint mb-1">{heading}</div>
      <div className="flex flex-wrap gap-1">
        {stops.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onChange(s)}
            className={
              "h-6 px-2 text-[11.5px] rounded-sm border transition-colors duration-150 cursor-pointer " +
              (value === s
                ? "bg-accent/10 border-accent/40 text-accent-hi"
                : "bg-bg border-line text-ink-muted hover:border-line-strong hover:text-ink")
            }
          >
            {labelUsd(s)}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Inline priority/relevance slider ──────────────────────────────────────

function InlineRange({
  label,
  value,
  onChange,
  max = 100,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  max?: number;
  step?: number;
}) {
  return (
    <div className="flex items-center gap-2 h-8 pl-3 pr-1 border-l border-line">
      <span className="text-[12px] text-ink-muted whitespace-nowrap">
        {label}
      </span>
      <input
        type="range"
        min={0}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-20 accent-accent cursor-pointer"
        aria-label={`Minimum ${label}`}
      />
      <span className="num tabular-nums text-[12px] text-ink font-medium w-6 text-right">
        {value}
      </span>
    </div>
  );
}

// ── Active-filter chip row ────────────────────────────────────────────────

function ChipRow({
  state,
  setState,
}: {
  state: FilterState;
  setState: (next: FilterState | ((prev: FilterState) => FilterState)) => void;
}) {
  const chips: { key: string; label: string; clear: () => void }[] = [];

  if (state.query.trim()) {
    chips.push({
      key: "q",
      label: `"${state.query.trim()}"`,
      clear: () => setState((s) => ({ ...s, query: "" })),
    });
  }
  for (const ac of state.assetClasses) {
    chips.push({
      key: `ac-${ac}`,
      label: ac,
      clear: () =>
        setState((s) => ({
          ...s,
          assetClasses: s.assetClasses.filter((x) => x !== ac),
        })),
    });
  }
  for (const geo of state.geographies) {
    chips.push({
      key: `geo-${geo}`,
      label: `Geo: ${geo}`,
      clear: () =>
        setState((s) => ({
          ...s,
          geographies: s.geographies.filter((x) => x !== geo),
        })),
    });
  }
  for (const pid of state.planIds) {
    chips.push({
      key: `plan-${pid}`,
      label: `Plan: ${pid.slice(0, 8)}`,
      clear: () =>
        setState((s) => ({
          ...s,
          planIds: s.planIds.filter((x) => x !== pid),
        })),
    });
  }
  for (const ct of state.confidenceTiers) {
    chips.push({
      key: `conf-${ct}`,
      label: ct.charAt(0).toUpperCase() + ct.slice(1),
      clear: () =>
        setState((s) => ({
          ...s,
          confidenceTiers: s.confidenceTiers.filter(
            (x) => x !== ct,
          ) as ConfidenceTier[],
        })),
    });
  }
  if (state.dateRange && state.dateRange !== "all") {
    chips.push({
      key: "date",
      label: `Last ${state.dateRange} days`,
      clear: () => setState((s) => ({ ...s, dateRange: "all" })),
    });
  }
  if (state.checkSizeMin > 0 || state.checkSizeMax > 0) {
    const l =
      state.checkSizeMax > 0
        ? `${labelUsd(state.checkSizeMin)} – ${labelUsd(state.checkSizeMax)}`
        : `Check ≥ ${labelUsd(state.checkSizeMin)}`;
    chips.push({
      key: "cs",
      label: l,
      clear: () =>
        setState((s) => ({ ...s, checkSizeMin: 0, checkSizeMax: 0 })),
    });
  }
  if (state.unfundedMin > 0) {
    chips.push({
      key: "u",
      label: `Unfunded ≥ ${labelUsd(state.unfundedMin)}`,
      clear: () => setState((s) => ({ ...s, unfundedMin: 0 })),
    });
  }
  if (state.minPriority > 0) {
    chips.push({
      key: "pri",
      label: `Priority ≥ ${state.minPriority}`,
      clear: () => setState((s) => ({ ...s, minPriority: 0 })),
    });
  }
  if (state.minRelevance > 0) {
    chips.push({
      key: "rel",
      label: `Relevance ≥ ${state.minRelevance}`,
      clear: () => setState((s) => ({ ...s, minRelevance: 0 })),
    });
  }
  for (const d of state.directions) {
    chips.push({
      key: `dir-${d}`,
      label: `Direction: ${d}`,
      clear: () =>
        setState((s) => ({
          ...s,
          directions: s.directions.filter((x) => x !== d),
        })),
    });
  }

  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((c) => (
        <span
          key={c.key}
          className="inline-flex items-center gap-1 h-6 pl-2 pr-1 rounded-sm bg-accent/10 border border-accent/30 text-accent-hi text-[11.5px]"
        >
          <span className="truncate max-w-[220px]">{c.label}</span>
          <button
            type="button"
            onClick={c.clear}
            className="inline-flex items-center justify-center h-4 w-4 rounded-sm hover:bg-accent/20 cursor-pointer"
            aria-label={`Remove ${c.label}`}
          >
            <X className="h-2.5 w-2.5" strokeWidth={2.5} />
          </button>
        </span>
      ))}
    </div>
  );
}

// ── Hook: close popovers on outside click ─────────────────────────────────

function useOutsideClick(
  ref: React.RefObject<HTMLElement | null>,
  onOutside: () => void,
) {
  React.useEffect(() => {
    function handler(e: MouseEvent) {
      const el = ref.current;
      if (!el) return;
      if (e.target instanceof Node && !el.contains(e.target)) {
        onOutside();
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [ref, onOutside]);
}

// Exported so pages can ensure a default state shape when seeding.
export { DEFAULT_FILTER_STATE };
