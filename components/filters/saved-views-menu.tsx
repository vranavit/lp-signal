"use client";

import * as React from "react";
import { Bookmark, ChevronDown, Save, Trash2, X } from "lucide-react";
import {
  createSavedView,
  deleteSavedView,
  listSavedViews,
  type SavedView,
} from "@/app/actions/saved-filter-views";
import {
  DEFAULT_FILTER_STATE,
  activeFilterCount,
  type FilterState,
} from "./filter-state";

/**
 * Dropdown attached to the filter bar on /signals and /outreach. Lists
 * saved views for the current user + current page, applies one on click,
 * lets the user save the current filter combo, and delete views inline.
 *
 * If the migration hasn't been applied yet, the action returns an error
 * and we render the error inline rather than crashing.
 */
export function SavedViewsMenu({
  page,
  state,
  onApply,
}: {
  page: "outreach" | "signals";
  state: FilterState;
  onApply: (s: FilterState) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [views, setViews] = React.useState<SavedView[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [saveOpen, setSaveOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [isPending, startTransition] = React.useTransition();

  const containerRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const res = await listSavedViews(page);
      if (cancelled) return;
      if (res.ok) {
        setViews(res.data);
        setLoadError(null);
      } else {
        setViews([]);
        setLoadError(res.error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, page]);

  React.useEffect(() => {
    function handler(e: MouseEvent) {
      const el = containerRef.current;
      if (!el) return;
      if (e.target instanceof Node && !el.contains(e.target)) {
        setOpen(false);
        setSaveOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function onApplyView(v: SavedView) {
    // Hydrate with defaults so older saves don't crash when new fields are
    // added to FilterState.
    onApply({ ...DEFAULT_FILTER_STATE, ...v.filter_json });
    setOpen(false);
  }

  function onSaveClick() {
    setSaveOpen(true);
    setSaveError(null);
    setName("");
  }

  function onSaveSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setSaveError("Name is required.");
      return;
    }
    startTransition(async () => {
      const res = await createSavedView({
        name: trimmed,
        page,
        filter_json: state,
      });
      if (!res.ok) {
        setSaveError(res.error);
        return;
      }
      setViews((prev) => [res.data, ...(prev ?? [])]);
      setSaveOpen(false);
      setName("");
    });
  }

  function onDelete(v: SavedView) {
    startTransition(async () => {
      const res = await deleteSavedView(v.id);
      if (res.ok) {
        setViews((prev) => (prev ?? []).filter((x) => x.id !== v.id));
      } else {
        setLoadError(res.error);
      }
    });
  }

  const count = activeFilterCount(state);
  const disableSave = count === 0;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((x) => !x)}
        className="h-8 pl-2.5 pr-2 text-[13px] bg-bg border border-line rounded-sm inline-flex items-center gap-2 cursor-pointer hover:border-line-strong text-ink-muted hover:text-ink focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
      >
        <Bookmark className="h-3.5 w-3.5" strokeWidth={1.75} />
        <span>Views</span>
        <ChevronDown className="h-3.5 w-3.5 text-ink-faint" strokeWidth={1.75} />
      </button>
      {open ? (
        <div className="absolute right-0 z-30 mt-1 w-[300px] bg-bg-subtle border border-line rounded-sm shadow-lg">
          <div className="px-2 py-1.5 border-b border-line flex items-center justify-between">
            <span className="text-[11.5px] uppercase text-ink-faint tracking-wide">
              Your views
            </span>
            <button
              type="button"
              onClick={onSaveClick}
              disabled={disableSave}
              className={
                "inline-flex items-center gap-1 text-[11.5px] rounded-sm border px-1.5 py-0.5 transition-colors cursor-pointer " +
                (disableSave
                  ? "border-line text-ink-dim cursor-not-allowed"
                  : "border-accent/40 text-accent-hi hover:bg-accent/10")
              }
              title={
                disableSave
                  ? "Set at least one filter to save a view."
                  : "Save current filters as a view"
              }
            >
              <Save className="h-3 w-3" strokeWidth={1.75} />
              Save current
            </button>
          </div>

          {saveOpen ? (
            <form
              onSubmit={onSaveSubmit}
              className="px-2 py-2 border-b border-line"
            >
              <label className="text-[11px] text-ink-faint block mb-1">
                View name
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  autoFocus
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={80}
                  placeholder='e.g. "Infra $50–200M US PE"'
                  className="flex-1 h-7 px-2 text-[12.5px] bg-bg border border-line rounded-sm text-ink focus:outline-none focus:border-accent"
                />
                <button
                  type="submit"
                  disabled={isPending}
                  className="h-7 px-2 text-[11.5px] bg-accent text-white border border-accent-hi rounded-sm cursor-pointer hover:bg-accent-hi disabled:opacity-50"
                >
                  {isPending ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() => setSaveOpen(false)}
                  className="h-7 w-7 inline-flex items-center justify-center border border-transparent hover:border-line rounded-sm cursor-pointer text-ink-faint hover:text-ink"
                  aria-label="Cancel"
                >
                  <X className="h-3 w-3" strokeWidth={2} />
                </button>
              </div>
              {saveError ? (
                <div className="mt-1.5 text-[11px] text-red-600">
                  {saveError}
                </div>
              ) : null}
            </form>
          ) : null}

          <div className="max-h-[320px] overflow-y-auto p-1">
            {views == null ? (
              <div className="px-2 py-3 text-[12px] text-ink-faint">Loading…</div>
            ) : loadError ? (
              <div className="px-2 py-2.5 text-[11.5px] text-red-600 leading-snug">
                {loadError.includes(
                  'relation "public.saved_filter_views" does not exist',
                )
                  ? "Saved views migration not yet applied. Run the latest migration."
                  : loadError}
              </div>
            ) : views.length === 0 ? (
              <div className="px-2 py-3 text-[12px] text-ink-faint">
                No saved views yet. Set filters and click “Save current”.
              </div>
            ) : (
              views.map((v) => (
                <div
                  key={v.id}
                  className="flex items-center gap-1.5 rounded-sm hover:bg-bg-hover"
                >
                  <button
                    type="button"
                    onClick={() => onApplyView(v)}
                    className="flex-1 text-left px-2 py-1.5 text-[13px] text-ink cursor-pointer"
                  >
                    <div className="truncate">{v.name}</div>
                    <div className="text-[10.5px] text-ink-faint num tabular-nums">
                      {v.created_at.slice(0, 10)}
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(v)}
                    disabled={isPending}
                    className="h-6 w-6 inline-flex items-center justify-center text-ink-faint hover:text-red-600 rounded-sm cursor-pointer"
                    aria-label={`Delete ${v.name}`}
                  >
                    <Trash2 className="h-3 w-3" strokeWidth={1.75} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
