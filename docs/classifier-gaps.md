# Classifier gaps

Surfaced during Day 9.5 · H-3 retry work (audit finding H-3 in `docs/audits/tech-audit-2026-04-23.md`). Track here rather than fixing inline — prompt changes belong in a dedicated Phase 2 session.

## Gap 1 — `null` numeric fields bypass the prompt's omit-instead-of-guess rule

**Evidence: 4 documents stuck in `processing_status='error'`**

| doc id prefix | plan | meeting | Zod path | error |
|---|---|---|---|---|
| 12e68881 | WSIB | 2026-04-02 | `signals[0].fields.<numeric>` | expected number, received null |
| 603394de | CalPERS | 2026-03-16 | `signals[0].fields.{old,new}_target_pct` | expected number, received null |
| a0d53d69 | CalPERS | 2026-03-16 | `signals[0].fields.{old,new}_target_pct` | expected number, received null |
| 680682cc | CalPERS | 2024-11-18 | `signals[0..3].fields.amount_usd` | expected number, received null |

**What's happening.** The Zod schema in `lib/classifier/schema.ts` requires:

- `t1Fields.amount_usd: z.number().int().positive()` (required, strictly positive)
- `t2Fields.old_target_pct / new_target_pct: z.number()` (required)
- `t3Fields.prior_year_pacing_usd / new_year_pacing_usd: z.number().int().nonnegative()` (required)

The v2.3 prompt tells the model to *omit the whole signal* if it can't extract a dollar amount (and, by extension, if any required numeric is missing). The model is instead emitting signals with `"amount_usd": null` or `"old_target_pct": null`. Zod's `safeParse` rejects the *entire response* — one null field discards every signal the model found in the document.

**Impact.** At least 4 CalPERS / WSIB board documents that likely contain valid T1 commitments or T2 target changes are producing zero signals. For example `680682cc` produces 4+ signals before the null trips the validator; those are dropped wholesale.

**Recommended prompt fix (Phase 2).**

Option A — tighten the prompt: add an explicit rule like

> If you cannot determine a required numeric field (`amount_usd`, `old_target_pct`, `new_target_pct`, `prior_year_pacing_usd`, `new_year_pacing_usd`) with confidence ≥ 0.7, OMIT the entire signal. Do NOT emit `null` for these fields. An empty signals array is preferable to a partial one.

Option B — loosen the schema: make the numeric fields `z.number().nullable()` and handle null downstream (render "—" in UI, exclude from aggregates). Trades off against the design intent ("zero never reaches the DB").

Option A is the right call — the schema's strictness is a feature, not a bug. The fix is a single paragraph in `lib/classifier/prompt.ts`.

**Not done this session** per the H-3 hard-stop rule: >3 docs hidden by a prompt gap → pause, surface to user, do not modify the prompt without its own dedicated session.

---

## Gap 2 — `signals` key missing from tool response (transient, 1 doc)

**Evidence: 1 document.**

| doc id prefix | plan | meeting | Zod path | error |
|---|---|---|---|---|
| 9987c5ce | CalPERS | 2024-11-18 | `signals` | expected array, received undefined |

The tool call Anthropic returned had no `signals` key at all. The schema has `signals: z.preprocess(..., z.array(signalSchema).default([]))` which should default-to-empty when `signals` is undefined — but didn't, probably because `z.preprocess` wraps `.default()` in a way that doesn't propagate on undefined input (Zod quirk). One-off observation; not reproducible from 4 sibling runs.

**Recommended fix.** Either move `.default([])` to the object-level (`z.object({...}).partial().merge(z.object({ signals: z.array(signalSchema) }))` with a fallback), or catch the specific "signals Required" error in the classifier orchestrator and treat it as an empty-signals response. ~30 min of work; do alongside Gap 1.

---

## Not-gaps

- **3 out_of_scope: transcript** (CalPERS meeting transcripts) — the URL-pattern filter in `classifyDocument` correctly rejects transcripts per the Phase 2 decision to skip them. Preserved by design.
- **1 too_long: 120 pages (max 100)** (CalPERS 2026-03-16 item06b-02) — `MAX_PAGES=100`. Real constraint; needs a chunking strategy to address. Deferred to Phase 4 alongside continuous ingestion.
