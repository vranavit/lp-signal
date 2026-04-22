# Proposal: Confidence-tiered auto-approval

**Status:** draft, not implemented
**Author:** Claude (for Vitek)
**Date:** 2026-04-21
**Decision needed by:** before we scale ingestion past CalPERS

---

## 1. Problem

Today every extracted signal lands in `/signals/review` and a human has to click through each one. That was fine when we were validating the classifier on one pension plan, but it won't scale:

- Tonight's batch had 20 pending → 19 were trivially "approve" (conf ≥ 0.80), 1 was trivially "delete" (garbage index row that should never have been T1).
- When we add the next 5–10 plans, the review queue becomes the bottleneck, not the model.
- Operators start rubber-stamping instead of reading, which defeats the point of review.

The model is already producing a calibrated `confidence` (0–1). We should let it do more of the work and reserve human attention for the genuinely ambiguous middle.

## 2. Proposed tiers

| Tier          | Confidence   | Behavior                                                                   | Dashboard visibility |
| ------------- | ------------ | -------------------------------------------------------------------------- | -------------------- |
| **Accepted** | ≥ 0.85       | `validated_at = now()` at insert time. No human touch.                     | Visible, normal.     |
| **Preliminary** | 0.70–0.85 | `validated_at = now()`, `preliminary = true`. Visible but flagged.         | Visible, flagged.    |
| **Rejected**  | < 0.70       | Not written to `signals`. Written to `rejected_signals` for prompt tuning. | Hidden.              |

Rationale for the thresholds:
- **0.85** — current T1 extractions on CalPERS cluster at exactly 0.85. It's where the model stops hedging.
- **0.70** — below this we saw the FTSE/Other garbage (0.78 was still too high — more on that in §6).
- These are starting points, not load-bearing. We expect to re-tune after 2–3 weeks of logged rejections.

## 3. Schema changes

### 3.1 `signals`
```sql
alter table public.signals
  add column preliminary boolean not null default false;

create index signals_preliminary_idx
  on public.signals (preliminary) where preliminary = true;
```

Keep `validated_at` as-is. "Preliminary" is an orthogonal flag, not a third validation state — preliminary rows are still published; they just carry a visual caveat.

### 3.2 `rejected_signals` (new)
```sql
create table public.rejected_signals (
  id              uuid primary key default gen_random_uuid(),
  document_id     uuid references public.documents(id) on delete set null,
  plan_id         uuid not null references public.plans(id) on delete cascade,
  signal_type     int  not null check (signal_type in (1, 2, 3)),
  confidence      numeric(3, 2) not null,
  asset_class     text,
  summary         text,
  fields          jsonb not null default '{}'::jsonb,
  source_page     int,
  source_quote    text,
  rejection_reason text not null default 'low_confidence',  -- future: 'duplicate', 'schema_violation', etc.
  model_version   text,
  prompt_version  text,
  created_at      timestamptz not null default now()
);

create index rejected_signals_plan_idx     on public.rejected_signals (plan_id);
create index rejected_signals_created_idx  on public.rejected_signals (created_at desc);
create index rejected_signals_reason_idx   on public.rejected_signals (rejection_reason);
```

Intentionally **not** FK-linked to `signals` (these never become signals). Carry `model_version` / `prompt_version` so when we change the prompt we can see which rejections were attributable to which prompt.

## 4. Classifier changes

One place changes: `scripts/classify-pending.ts` (and whatever inline classifier we call from the scrape path). Pseudocode:

```ts
for (const extracted of llmOutput.signals) {
  const c = extracted.confidence;

  if (c < 0.70) {
    await insertRejected(extracted, { reason: "low_confidence" });
    continue;
  }

  await insertSignal({
    ...extracted,
    preliminary: c < 0.85,
    validated_at: new Date(),  // auto-approve both tiers
  });
}
```

No change to `priority_score` logic. Preliminary rows still rank by priority in the dashboard — the flag is visual, not positional.

## 5. UI changes

**`/signals` page** — add a preliminary badge on the row. Use a muted accent dot + "preliminary" label; no red, no warning icons — Linear/Attio aesthetic, not JIRA. One new filter chip: "Hide preliminary" (off by default).

**`/signals/review`** — repurpose, don't delete. Two new sections:
1. "Preliminary" — list of `preliminary = true` rows. Operator actions: confirm (unsets flag) or reject (moves to `rejected_signals`).
2. "Recently rejected" — read-only view of `rejected_signals` from the last 7 days. Enables "this should have been accepted" feedback → drives prompt tuning.

The existing pending-review queue goes away, because nothing lands there anymore.

## 6. Calibration & guardrails

A few things to resolve before shipping:

- **The FTSE Climate row had confidence 0.78.** It would have landed in the preliminary tier under this proposal, not rejected. That's actually correct behavior — it was a real extraction, just a bad *scope* call (index allocation, not a commitment). Fix belongs in the prompt (tighten T1 scope to exclude index-tracking allocations), not in the threshold. Flagging explicitly because it slightly undermines the "< 0.70 is garbage" narrative.
- **Preliminary cannot be the default.** If the model starts drifting low, we'd silently publish weaker data. Add a per-day alert: if `preliminary_count / accepted_count > 0.30` for a plan, page me.
- **Rejection recall.** We should periodically sample `rejected_signals` and manually check for false rejects. Suggest: weekly, 20-row random sample, track precision@recall in a spreadsheet until we have real tooling.

## 7. Scope for the build

Rough budget:
- Schema migration + backfill (`preliminary = false` for existing rows): 30 min
- Classifier wiring + rejection insert: 1 hr
- `/signals` preliminary badge + filter: 1 hr
- `/signals/review` repurpose: 2 hr
- Basic rejection-reason alert (cron + log line is fine for v1): 30 min

Total: ~5 hours. One evening.

## 8. What this proposal deliberately does not do

- **No ML-driven threshold tuning.** Hard-coded 0.70 / 0.85 is fine until we have volume.
- **No operator override of confidence.** If you disagree with the model, you delete or confirm — you don't edit the score. Keeps the rejection log clean as training signal.
- **No per-asset-class thresholds.** Tempting (T2 rebalances are noisier than T1 commitments) but premature. Revisit after 100+ rejected rows.
- **No auto-retry on rejected rows.** When the prompt improves, we re-run classification from the raw document. Don't try to "repair" a rejected row in place.

## 9. Open questions for tomorrow

1. Do we want a third threshold for `priority_score` (e.g., auto-approve only if conf ≥ 0.85 **and** priority ≥ 40)? Would cut T2 "Other / -" noise further.
2. Should `rejected_signals` have RLS? Leaning no — it's internal tuning data, not customer-visible — but worth a beat of thought.
3. Who sees "preliminary" rows — all seats, or only admins? My default is all seats with the badge, since hiding them from IRs defeats the point of publishing them.
