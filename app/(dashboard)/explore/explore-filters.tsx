"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Copy, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  approvalTypeFull,
  type ExplorePlan,
} from "./explore-types";
import {
  DEFAULT_EXPLORE_STATE,
  type ExploreFilterState,
  type TimePreset,
} from "./use-explore-filter-state";

const TIME_PRESETS: Array<{ value: TimePreset; label: string }> = [
  { value: "30d", label: "Last 30 days" },
  { value: "60d", label: "Last 60 days" },
  { value: "6mo", label: "Last 6 months" },
  { value: "12mo", label: "Last 12 months" },
  { value: "all", label: "All time" },
  { value: "custom", label: "Custom range" },
];

function activeFilterCount(s: ExploreFilterState): number {
  let n = 0;
  if (s.assetClasses.length) n++;
  if (s.planIds.length) n++;
  if (s.approvalTypes.length) n++;
  if (s.timePreset !== DEFAULT_EXPLORE_STATE.timePreset) n++;
  if (s.minAmount > 0) n++;
  if (s.maxAmount > 0) n++;
  if (s.query.trim()) n++;
  return n;
}

export function ExploreFilters({
  state,
  setState,
  reset,
  plans,
  assetOptions,
  approvalTypeOptions,
}: {
  state: ExploreFilterState;
  setState: (next: ExploreFilterState | ((prev: ExploreFilterState) => ExploreFilterState)) => void;
  reset: () => void;
  plans: ExplorePlan[];
  assetOptions: string[];
  approvalTypeOptions: string[];
}) {
  const [copied, setCopied] = useState(false);
  // Debounced query input. Component holds the local string and pushes to URL
  // 150ms after the user stops typing.
  const [draftQuery, setDraftQuery] = useState(state.query);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-sync local input when URL changes externally (e.g. reset, back button).
  useEffect(() => {
    setDraftQuery(state.query);
  }, [state.query]);

  useEffect(() => {
    if (draftQuery === state.query) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setState((s) => ({ ...s, query: draftQuery }));
    }, 150);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftQuery]);

  const count = activeFilterCount(state);

  function copyLink() {
    if (typeof window === "undefined") return;
    navigator.clipboard?.writeText(window.location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }

  function fmtMillions(usd: number): string {
    if (usd <= 0) return "";
    return String(Math.round(usd / 1_000_000));
  }

  function parseMillions(s: string): number {
    const cleaned = s.replace(/[^0-9]/g, "");
    if (!cleaned) return 0;
    const m = Number(cleaned);
    if (!Number.isFinite(m) || m < 0) return 0;
    return Math.round(m * 1_000_000);
  }

  return (
    <div className="card-surface space-y-2 px-2.5 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <MultiSelect
          label="Asset class"
          value={state.assetClasses}
          onChange={(v) => setState((s) => ({ ...s, assetClasses: v }))}
          options={assetOptions.map((v) => ({ value: v, label: v }))}
        />
        <MultiSelect
          label="Plan"
          value={state.planIds}
          onChange={(v) => setState((s) => ({ ...s, planIds: v }))}
          options={plans.map((p) => ({ value: p.id, label: p.name }))}
          width="w-[260px]"
        />
        <MultiSelect
          label="Approval type"
          value={state.approvalTypes}
          onChange={(v) => setState((s) => ({ ...s, approvalTypes: v }))}
          options={approvalTypeOptions.map((v) => ({
            value: v,
            label: approvalTypeFull(v),
          }))}
          width="w-[200px]"
        />
        <SingleSelect
          label="Time"
          value={state.timePreset}
          onChange={(v) =>
            setState((s) => ({ ...s, timePreset: v as TimePreset }))
          }
          options={TIME_PRESETS}
          width="w-[180px]"
        />

        <div className="ml-auto flex items-center gap-2">
          {count > 0 ? (
            <span className="text-[11px] text-ink-faint">
              {count} filter{count > 1 ? "s" : ""} active
            </span>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={reset}
            disabled={count === 0}
          >
            Reset
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={copyLink}
            title="Copy current URL to clipboard"
          >
            <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
            {copied ? "Copied" : "Copy link"}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {state.timePreset === "custom" ? (
          <div className="inline-flex items-center gap-1.5">
            <span className="text-[11px] text-ink-faint">From</span>
            <input
              type="date"
              value={state.fromDate ?? ""}
              onChange={(e) =>
                setState((s) => ({ ...s, fromDate: e.target.value || null }))
              }
              className="h-8 px-2 text-[12px] bg-bg border border-line rounded-sm text-ink focus-visible:outline-none focus-visible:border-accent focus-visible:ring-1 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-bg"
            />
            <span className="text-[11px] text-ink-faint">to</span>
            <input
              type="date"
              value={state.toDate ?? ""}
              onChange={(e) =>
                setState((s) => ({ ...s, toDate: e.target.value || null }))
              }
              className="h-8 px-2 text-[12px] bg-bg border border-line rounded-sm text-ink focus-visible:outline-none focus-visible:border-accent focus-visible:ring-1 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-bg"
            />
          </div>
        ) : null}

        <div className="inline-flex items-center gap-1.5">
          <span className="text-[11px] text-ink-faint">Min $</span>
          <input
            type="text"
            inputMode="numeric"
            placeholder="0"
            value={fmtMillions(state.minAmount)}
            onChange={(e) =>
              setState((s) => ({ ...s, minAmount: parseMillions(e.target.value) }))
            }
            className="h-8 w-[80px] px-2 text-[12px] bg-bg border border-line rounded-sm text-ink num tabular-nums focus-visible:outline-none focus-visible:border-accent focus-visible:ring-1 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-bg"
          />
          <span className="text-[11px] text-ink-faint">M</span>
        </div>

        <div className="inline-flex items-center gap-1.5">
          <span className="text-[11px] text-ink-faint">Max $</span>
          <input
            type="text"
            inputMode="numeric"
            placeholder="no max"
            value={fmtMillions(state.maxAmount)}
            onChange={(e) =>
              setState((s) => ({ ...s, maxAmount: parseMillions(e.target.value) }))
            }
            className="h-8 w-[80px] px-2 text-[12px] bg-bg border border-line rounded-sm text-ink num tabular-nums focus-visible:outline-none focus-visible:border-accent focus-visible:ring-1 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-bg"
          />
          <span className="text-[11px] text-ink-faint">M</span>
        </div>

        <div className="relative flex-1 min-w-[220px] max-w-[420px]">
          <Search
            className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-faint pointer-events-none"
            strokeWidth={1.75}
          />
          <input
            type="text"
            value={draftQuery}
            onChange={(e) => setDraftQuery(e.target.value)}
            placeholder="Search GP or fund name"
            className="h-8 w-full pl-8 pr-7 text-[13px] bg-bg border border-line rounded-sm text-ink placeholder:text-ink-dim focus-visible:outline-none focus-visible:border-accent focus-visible:ring-1 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-bg transition-colors duration-150"
          />
          {draftQuery ? (
            <button
              type="button"
              onClick={() => setDraftQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink"
              aria-label="Clear search"
            >
              <X className="h-3 w-3" strokeWidth={2} />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ─── Multi/Single select primitives ────────────────────────────────────────
// Lightweight popover dropdowns. Match the visual feel of the existing
// CombinationFilter MultiSelect but kept local since we don't need the full
// option-hint machinery.

type Option = { value: string; label: string };

function MultiSelect({
  label,
  value,
  onChange,
  options,
  width = "w-[180px]",
}: {
  label: string;
  value: string[];
  onChange: (next: string[]) => void;
  options: Option[];
  width?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const active = value.length > 0;
  const selectedLabel =
    value.length === 0
      ? "all"
      : value.length === 1
      ? options.find((o) => o.value === value[0])?.label ?? value[0]
      : `${value.length} selected`;

  return (
    <div className={`relative ${width}`} ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={
          "h-8 w-full px-2.5 inline-flex items-center justify-between gap-2 bg-bg rounded-sm text-[12.5px] transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-bg " +
          (open || active
            ? "border border-line-strong text-ink"
            : "border border-line text-ink-muted hover:border-line-strong")
        }
      >
        <span className="text-ink-faint">{label}:</span>
        <span className="flex-1 text-left truncate text-ink">{selectedLabel}</span>
        {active ? (
          <span className="font-mono tabular-nums text-[10.5px] bg-accent/10 text-accent-hi border border-accent/30 rounded-sm px-1">
            {value.length}
          </span>
        ) : null}
        <ChevronDown
          className={
            "h-3.5 w-3.5 text-ink-faint transition-transform duration-150 " +
            (open ? "rotate-180" : "")
          }
          strokeWidth={1.75}
        />
      </button>
      {open ? (
        <div className="absolute z-20 mt-1 w-[max(100%,260px)] bg-bg-panel border border-line rounded-sm shadow-md max-h-[320px] overflow-auto">
          {value.length > 0 ? (
            <button
              type="button"
              onClick={() => onChange([])}
              className="w-full text-left px-2.5 py-1.5 text-[11px] text-ink-faint hover:text-ink hover:bg-bg-hover border-b border-line"
            >
              Clear selection
            </button>
          ) : null}
          {options.length === 0 ? (
            <div className="px-2.5 py-2 text-[12px] text-ink-faint">
              No options
            </div>
          ) : (
            options.map((o) => {
              const checked = value.includes(o.value);
              return (
                <label
                  key={o.value}
                  className="flex items-center gap-2 px-2.5 py-1.5 text-[12.5px] text-ink hover:bg-bg-hover cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {
                      if (checked) onChange(value.filter((v) => v !== o.value));
                      else onChange([...value, o.value]);
                    }}
                    className="h-3.5 w-3.5 accent-accent"
                  />
                  <span className="truncate">{o.label}</span>
                </label>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}

function SingleSelect({
  label,
  value,
  onChange,
  options,
  width = "w-[160px]",
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: Option[];
  width?: string;
}) {
  return (
    <div className={`relative ${width}`}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-full pl-2.5 pr-7 appearance-none bg-bg border border-line rounded-sm text-[12.5px] text-ink hover:border-line-strong transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:border-line-strong focus-visible:ring-1 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-bg"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {label}: {o.label}
          </option>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-faint"
        strokeWidth={1.75}
      />
    </div>
  );
}
