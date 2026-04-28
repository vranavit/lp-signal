# Audit 4 — Schema / DB (2026-04-29)

Continuation of the institutional 5-audit pass. Audit 1 (data
integrity) closed 2026-04-28 on commit `ee33782`. Audit 2 (code
quality) closed 2026-04-29 on commit `60e2fcd`. Audit 3
(visual/UX, code-side) closed 2026-04-29 on commit `0645654`.
Audit 4 examines schema design, foreign-key integrity, indexes,
RLS policy completeness, migration tracking, and constraint
coverage.

## Reproducibility metadata

| Field | Value |
|---|---|
| Audit performed | 2026-04-29 |
| Commit hash at audit start | `0645654` |
| Database snapshot | production state as of 2026-04-29 |
| Auditor | Vitek Vrana (with assistance from Claude) |
| Methodology | 6 sub-audits (FK integrity, index coverage, RLS policy completeness, migration tracking, schema gap follow-through, constraint validation) |
| Tooling | Node.js `pg` client, `information_schema`, `pg_indexes`, `pg_policies`, `pg_constraint` |

## Scope limitations

This audit examines:

- Foreign-key constraints and orphaned-row detection across all
  `public` tables
- Index coverage on primary keys and FK columns
- RLS state and policy completeness per table
- Migration tracking infrastructure (or lack thereof)
- Schema gaps surfaced in earlier audits (P4.1 fee_period)
- Constraint coverage and uniqueness enforcement

This audit does **not** examine:

- Data correctness in plan_consultants or other tables
  (Audit 1)
- Code quality, error handling shape, security risks (Audit 2)
- Visual rendering, mobile responsiveness, accessibility
  (Audit 3)
- Production readiness, monitoring, deploy pipeline,
  authorization model (Audit 5)
- Query performance benchmarking under load
- Storage, bloat, vacuum tuning
- Backup / recovery procedures
- `auth.*` schema (managed by Supabase) beyond cross-references
  to `public` tables that join into it

## Summary

| Severity | Count | Open |
|---|---|---|
| P0 | 0 | 0 |
| P1 | 1 | 1 |
| P2 | 5 | 5 |
| P3 | 1 | 1 |

P0: none. **P1: one** — P4.3 migration tracking (per user
direction, default to P1 unless solo-dev case justifies
downgrade). **P2: five** — the two pre-loaded fee_period
findings (P4.1 schema, P4.2 code companion), plus three new
ones surfaced by sub-audits: 5 FK columns missing indexes
(P4.4), `gps` table has RLS disabled while every other public
table has it enabled (P4.5), and the `asset_class` CHECK enum
drifts between `pension_allocations` (9 values) and
`signals` / `rejected_signals` (6 values) (P4.6). **P3: one
informational** — 5 tables carry RLS=true with zero policies
(service-role-only by design but undocumented).

Net: schema is structurally sound — zero orphan rows across
15 FKs, every table has a primary key, 29 well-defined
UNIQUE/CHECK constraints, RLS coverage is near-complete. The
P1/P2 cluster is concentrated in operational hardening
(migration tracking, missing indexes, taxonomy drift), not
data-model correctness.

## Pre-loaded findings (from cross-audit work)

### P4.1 (pre-loaded from Audit 1 P2.7) — No `fee_period` column on `plan_consultants`

Surfaced during Audit 1 SWIB Phase 4 deep-scan. The schema has
`fee_usd` (numeric) + `fee_year` (integer) but no
`fee_period` enum to indicate quarterly / annual / YTD /
monthly. This forced both SWIB StepStone rows to keep
`fee_usd = NULL` because quarterly figures from the SWIB Board
packets would render misleadingly as annual under the UI's
implicit "fee_usd is annual" assumption.

**Severity: P2.** **Status: OPEN.** To be resolved via the
migration proposed in Sub-audit 4.5.

### P4.2 (pre-loaded from Audit 2 P2.3 surface) — Code-side companion to fee_period gap

Audit 2 confirmed zero references to `fee_period`,
`quarterly`, `annualized` in `app/`, `lib/`, `components/`.
The classifier prompt also assumes annual fees ("Extract one
row per (firm, mandate, fee_year) tuple"). Resolution path is
joint with P4.1: schema migration + classifier-prompt update +
UI rendering update to display the period unit alongside
fee_usd.

**Severity: P2.** **Status: OPEN.**

### P4.3 (new) — No Supabase CLI migration tracking

Surfaced during Audit 0 baseline (yesterday). Migrations are
applied ad-hoc via `scripts/apply-migration.ts`. The
`supabase_migrations.schema_migrations` tracking table does
not exist on this DB, so there is no programmatic record of
which migration files have been applied — it's all
behavioral verification (query the schema and confirm the
expected column / policy / constraint exists).

Risks:
- New engineer joining cannot deterministically replay
  migrations.
- Parallel development on a separate branch could land a
  migration locally without the production DB knowing about
  it.
- Branch / staging environments cannot be built from the
  migration set without a manual re-application script.

**Severity: P1** (default per user direction unless explicit
reason to downgrade). **Status: OPEN.** Resolution: adopt
either Supabase CLI migrations (`supabase db push` flow) or a
custom tracking table maintained by `apply-migration.ts`.

---

## Sub-audit 4.1 — Foreign-key integrity

15 FK constraints across `public` schema. **Zero orphaned
child rows.**

| FK column | → ref | delete_rule |
|---|---|---|
| `allocation_policy_changes.plan_id` | `plans.id` | CASCADE |
| `documents.gp_id` | `gps.id` | CASCADE |
| `documents.plan_id` | `plans.id` | CASCADE |
| `pension_allocations.plan_id` | `plans.id` | CASCADE |
| `pension_allocations.source_document_id` | `documents.id` | SET NULL |
| `plan_consultants.consultant_id` | `consultants.id` | RESTRICT |
| `plan_consultants.plan_id` | `plans.id` | CASCADE |
| `plan_consultants.source_document_id` | `documents.id` | SET NULL |
| `rejected_signals.document_id` | `documents.id` | SET NULL |
| `rejected_signals.gp_id` | `gps.id` | CASCADE |
| `rejected_signals.plan_id` | `plans.id` | CASCADE |
| `signals.document_id` | `documents.id` | SET NULL |
| `signals.gp_id` | `gps.id` | CASCADE |
| `signals.plan_id` | `plans.id` | CASCADE |
| `user_profiles.firm_id` | `firms.id` | SET NULL |

`update_rule` is NO ACTION on every FK, which is standard
(primary keys aren't expected to mutate).

**Delete-rule semantics review**:

- **CASCADE on plan_id / gp_id**: child rows (allocations,
  signals, plan_consultants, etc.) are removed when their
  parent plan / GP is deleted. Sensible — these rows have no
  meaning without their parent.
- **SET NULL on source_document_id / document_id**: deleting a
  document strips provenance from the child row but keeps the
  data. Sensible for data preservation.
- **RESTRICT on consultant_id**: prevents deleting a consultant
  while `plan_consultants` references it — forces explicit
  cleanup. Sensible.
- **SET NULL on user_profiles.firm_id**: a user can persist
  even if their firm is deleted. Sensible.

**Cross-schema FK note**: `user_profiles.id → auth.users.id`
exists (verified yesterday during the auth-allowlist diagnosis,
delete_rule=CASCADE) but does not appear in this query's
output because `information_schema.constraint_column_usage`
filters by `table_schema='public'` and `auth.users` is in the
`auth` schema. The FK is real and correctly configured.

**No findings.** FK integrity is clean.

---

## Sub-audit 4.2 — Index coverage

54 indexes across `public` schema. **0 tables without primary
key.** **5 FK columns without indexes.**

### P4.4 — 5 FK columns lack indexes (performance)

| Table | FK column |
|---|---|
| `pension_allocations` | `source_document_id` |
| `plan_consultants` | `source_document_id` |
| `rejected_signals` | `document_id` |
| `signals` | `document_id` |
| `user_profiles` | `firm_id` |

The two `source_document_id` columns are user-facing — the
`/pensions/[slug]` page query joins
`plan_consultants ↔ documents` via `source_document_id`. Same
for the signals page. Without an index, JOINs degrade to
sequential scans on the child table.

For 75 `plan_consultants` rows and 422 `documents` rows the
performance impact is invisible today, but as the dataset
grows it'll become a real cost. Trivially fixable with five
single-column indexes. **Severity: P2.** Status: OPEN.
Proposed fix migration:

```sql
create index if not exists pension_allocations_source_doc_idx
  on public.pension_allocations(source_document_id);
create index if not exists plan_consultants_source_doc_idx
  on public.plan_consultants(source_document_id);
create index if not exists rejected_signals_document_idx
  on public.rejected_signals(document_id);
create index if not exists signals_document_idx
  on public.signals(document_id);
create index if not exists user_profiles_firm_idx
  on public.user_profiles(firm_id);
```

### Notable index design observations (no findings)

- `plan_consultants_unique_mandate_year`: UNIQUE
  `(plan_id, consultant_id, mandate_type, fee_year)` with
  `NULLS NOT DISTINCT` — correctly prevents the duplicate
  insertion patterns Audit 1 worried about; multi-year
  duplicates (FY24 + FY25) are intentionally allowed because
  `fee_year` differs.
- `documents_plan_id_content_hash_key`: UNIQUE
  `(plan_id, content_hash)` — dedupes ingestion correctly.
- `pension_allocations_unique_idx`: UNIQUE
  `(plan_id, as_of_date, asset_class, COALESCE(sub_class, ''))`
  — handles the NULL sub_class case correctly via COALESCE.
- `plans_tier_idx`: partial index `WHERE active` — good
  partial-index discipline.
- `signals_t1_natural_key_idx`: partial UNIQUE index on T1
  signals' natural key, gating with
  `WHERE signal_type=1 AND seed_data=false`. Strong design.

---

## Sub-audit 4.3 — RLS policy completeness

17 tables in `public`. RLS state:

| State | Count | Tables |
|---|---|---|
| RLS enabled | 16 | all except `gps` |
| **RLS disabled** | **1** | **`gps`** |

14 policies total across 11 of the 16 RLS-enabled tables.

### P4.5 — `gps` table has RLS disabled (consistency gap)

Every other table in the `public` schema has `rowsecurity =
true`. `gps` (the GP / firm master list, ~20-50 rows) is the
outlier. With RLS off, access control falls back to PostgreSQL
role grants — anyone with `SELECT` on `gps` can read all rows;
anyone with `INSERT/UPDATE/DELETE` can write. Likely the table
is read by `authenticated` and written by service-role only,
but the security model isn't enforced at the table level.

**Severity: P2.** Status: OPEN. Two-step fix:

```sql
alter table public.gps enable row level security;
create policy "gps_read_authenticated"
  on public.gps for select to authenticated using (true);
```

This matches the pattern every other read-only table uses
(`plans`, `documents`, `consultants`, etc.) and converts the
implicit grant-based access model to explicit RLS-based.

### Tables with RLS=true and zero policies (service-role-only by design)

| Table | Use |
|---|---|
| `allowed_emails` | Read by `enforce_signin_allowlist` trigger (SECURITY DEFINER bypasses RLS) |
| `demo_requests` | Written by `app/actions/demo-request.ts` via admin client |
| `firms` | Bookkeeping; read/write via admin paths |
| `rejected_signals` | Audit data; written by classifier; not user-readable |
| `scrape_fingerprints` | Cron health-tracking; written by scrapers |

These follow a common Supabase pattern: RLS-enabled but with
zero policies acts as **deny-all** for non-service-role access.
Service-role and SECURITY DEFINER paths bypass RLS and can
still read/write. Functionally correct.

### P4.7 — 5 service-role-only tables have undocumented "deny-all" RLS pattern

The pattern is intentional but the design intent isn't
recorded in code or schema comments. An engineer who later
reads the schema sees "RLS enabled, no policies" and may try
to "fix" it by adding `using (true)` — which would silently
expose the table.

Recommended fix: a one-line `comment on table` per such table
documenting "service-role-only; no end-user policy by design."

```sql
comment on table public.allowed_emails is
  'Service-role / SECURITY DEFINER access only. Read by enforce_signin_allowlist trigger; never queried by user-facing code. RLS is intentionally policy-less = deny-all for non-service-role.';
-- repeat for demo_requests, firms, rejected_signals, scrape_fingerprints
```

**Severity: P3.** Status: OPEN.

### Read-only public-data policies (using "true" for SELECT to authenticated)

7 tables: `allocation_policy_changes`, `consultants`,
`documents`, `pension_allocations`, `plan_consultants`,
`plans`, `signals`. All have `qual = true` SELECT policies for
`authenticated`. Appropriate for the dashboard's read-only
public-data model.

### Owner-scoped policies (`auth.uid() = id` / `user_id`)

`firm_profiles`, `saved_filter_views`, `saved_searches`,
`user_profiles`. Each correctly scopes reads/writes to the row
owner via `auth.uid()`. Standard Supabase pattern.

### Authenticated-write policies

There are NO INSERT / UPDATE / DELETE policies on `plans`,
`documents`, `consultants`, `plan_consultants`,
`pension_allocations`, `signals`, etc. for `authenticated`.
Writes flow only through service-role admin clients in
server-only code. Correct security model. **No finding.**

---

## Sub-audit 4.4 — Migration tracking

```
local migration files: 41
supabase_migrations.schema_migrations: does NOT exist
```

Confirms P4.3 (pre-loaded). Migrations applied via
`scripts/apply-migration.ts` with no programmatic record of
which files have been applied.

**Severity: P1.** Status: OPEN. Risk profile in the pre-loaded
finding still applies: parallel development, branch / staging
environment reconstruction, and onboarding all blocked by the
absence of a tracking table.

Two viable resolution paths:

1. **Adopt Supabase CLI migrations** (`supabase db push`,
   `supabase migration new`, `supabase db reset` flow). Larger
   adoption cost — requires installing the CLI, restructuring
   the migration directory if not already aligned, and
   committing to the CLI's idempotency model. Pays back on
   any team scaling.
2. **Custom tracking table maintained by `apply-migration.ts`**:
   ```sql
   create table if not exists public.applied_migrations (
     filename text primary key,
     applied_at timestamptz not null default now(),
     checksum text
   );
   ```
   Modify `apply-migration.ts` to record entries on success +
   skip if already applied. Smaller adoption cost, no CLI
   dependency, fits existing tooling.

Either path closes P4.3.

---

## Sub-audit 4.5 — Schema gap follow-through (P4.1 fee_period migration)

Resolution path for P4.1 + P4.2 (the fee_period gap surfaced
in Audit 1 SWIB Phase 4 + Audit 2 P2.3). Migration drafted
below; **not applied** in this audit (per user instruction:
audit documents the migration; a separate fix session applies
+ updates the classifier prompt + UI).

```sql
-- supabase/migrations/20260429000001_add_fee_period.sql
alter table public.plan_consultants
  add column if not exists fee_period text
  check (fee_period in ('annual', 'quarterly', 'ytd', 'monthly'));

comment on column public.plan_consultants.fee_period is
  'Period basis for fee_usd. Distinguishes annual retainer from quarterly accrual / YTD-cumulative / monthly disclosures. NULL means period unknown / not yet captured.';
```

Backfill plan (also for the fix session, not this audit):

| Existing rows | Backfill | Rationale |
|---|---|---|
| 53 cafr_extraction with `fee_year` set | `fee_period = 'annual'` | CAFR Schedule of Investment Expenses is annual by convention |
| 22 manual_research rows where `fee_usd` is set | per-row decision | Some are annual, some are unknown; safer to leave NULL than misattribute |
| 4 SWIB StepStone rows (PE + RE; `fee_usd` already NULL) | `fee_period = 'quarterly'` | Documented in notes per Audit 1 Phase 4 deep-scan; backfilling `fee_period` makes the period explicit even though `fee_usd` stays NULL |

Companion code work for the fix session (cross-references
Audit 2 P2.3):

1. Update classifier prompt
   (`lib/classifier/prompts/consultants.ts`) to capture
   `fee_period` when disclosed.
2. Update `ConsultantRow` type in
   `app/(dashboard)/pensions/[slug]/page.tsx` to include
   `fee_period`.
3. Update `ConsultantLineItem` to render the period unit
   alongside fee_usd (e.g., `$60K /quarter` or
   `$2.4M /year`).

---

## Sub-audit 4.6 — Constraint and unique validation

29 UNIQUE + CHECK constraints across `public` schema. Most are
well-designed; one drift item flagged.

### P4.6 — `asset_class` CHECK enum drifts between `pension_allocations` and `signals` / `rejected_signals`

```
pension_allocations: ['PE', 'Infra', 'Credit', 'RE', 'VC',
                      'Public Equity', 'Fixed Income',
                      'Cash', 'Other']                     (9 values)
signals:             ['PE', 'Infra', 'Credit', 'RE', 'VC',
                      'Other']                              (6 values)
rejected_signals:    ['PE', 'Infra', 'Credit', 'RE', 'VC',
                      'Other']                              (6 values)
```

`pension_allocations` has 3 extra values (`Public Equity`,
`Fixed Income`, `Cash`) that don't exist in the signals
taxonomy. The drift is intentional in spirit — signals are
about private-markets transactions, allocations cover the
full portfolio — but the duplicate CHECK constraints are an
accident waiting to happen: any new asset class added in one
place will be missed in the other.

**Severity: P2.** Status: OPEN. Two cleanup options:

1. Promote the asset_class enum to a Postgres `CREATE TYPE`
   shared across tables (preferred). Requires migrations on
   all four tables to swap CHECK for the new type.
2. Document the intentional difference via column comments
   and accept the drift risk.

### Notable constraint design observations (no findings)

- `plan_consultants_unique_mandate_year` — UNIQUE NULLS NOT
  DISTINCT on `(plan_id, consultant_id, mandate_type,
  fee_year)`. Correctly prevents the duplication patterns
  Audit 1 worried about while permitting the intentional
  multi-year-duplicate semantics (Audit 1 P3.2).
- `plan_consultants_source_type_check` — 6-value enum
  including `manual_research` (added in Audit 1 Phase 2).
- `plan_consultants_mandate_type_check` — 9 values matching
  `consultants_default_specialties_check`. Good consistency
  between the relationship table and the master list.
- `pension_allocations_target_or_actual_check` — at least one
  of `target_pct` or `actual_pct` must be non-null. Smart
  guard against empty-row insertions.
- `pension_allocations_confidence_check` — 0..1 numeric
  range. Standard.
- `documents_processing_status_check` — 4-value lifecycle
  enum (`pending`, `processing`, `complete`, `error`).
- `user_profiles_role_check` — 2 values (`admin`, `user`).
  Only 2 roles; cross-references Audit 5 P5.1
  (`handle_new_user` defaults all signups to `admin` —
  the constraint allows the privilege escalation by not
  restricting more granularly).

---

## Recommended next steps

1. **P4.3 fix** (migration tracking, P1) — adopt one of the
   two paths in Sub-audit 4.4: Supabase CLI migrations OR
   custom `applied_migrations` table maintained by
   `apply-migration.ts`. **Highest priority** — every other
   schema fix below would benefit from being tracked when it
   ships.
2. **P4.1 + P4.2 + P4.6 schema fix session** (P2 cluster) —
   apply the proposed `add_fee_period` migration from
   Sub-audit 4.5, backfill per the table, update the
   classifier prompt and UI. Cross-references Audit 1 P2.7,
   Audit 2 P2.3, Audit 1 Phase 4 deep-scan annotations.
3. **P4.4 fix** (5 missing FK indexes, P2) — single migration
   adding 5 single-column indexes. Trivial; ships with the
   next migration batch.
4. **P4.5 fix** (gps RLS consistency, P2) — enable RLS on
   `gps` and add a `gps_read_authenticated` policy matching
   the pattern of every other read-only table.
5. **P4.6 fix** (asset_class taxonomy drift, P2) — choose
   between the shared `CREATE TYPE` or documented-drift
   options in Sub-audit 4.6.
6. **P4.7 fix** (service-role-only RLS pattern, P3) — five
   `comment on table` statements documenting the intentional
   "deny-all" pattern.
7. **Cross-reference: Audit 5 (production readiness)** — the
   migration tracking gap, the fee_period schema migration,
   and the `gps` RLS fix all touch on production-readiness
   concerns. Audit 5 may further constrain the resolution
   order.
