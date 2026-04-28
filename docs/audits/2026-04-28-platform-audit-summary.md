# Allocus Platform Audit - 2026-04-28

Comprehensive 5-audit pass conducted at end of Workstream 2
Phase A. All 20 active plans now have consultant data; 75
plan_consultants rows shipped on commit f076118.

## Baseline state at audit start

- Type-check: clean (pnpm tsc --noEmit exit 0)
- Lint: 3 pre-existing warnings (explore/), zero in consultant
  code
- Working tree: clean
- Branch: HEAD == origin/main == f076118
- Repo size: 252 .ts/.tsx files, 32,827 lines
- Database: 20 plans, 422 documents, 75 plan_consultants, 18
  consultants, 194 pension_allocations
- Migrations: 41 .sql files, applied via scripts/apply-migration.ts
  (no Supabase CLI tracking)

## Audit passes

1. [Data integrity audit](./2026-04-28-audit-1-data-integrity.md) — **completed 2026-04-28**
2. [Code quality audit](./2026-04-29-audit-2-code-quality.md) — **completed 2026-04-29**
3. [Visual / UX audit](./2026-04-29-audit-3-visual-ux.md) — pending
4. [Schema / DB audit](./2026-04-29-audit-4-schema-db.md) — pending
5. [Production readiness audit](./2026-04-28-audit-5-prod-readiness.md) — stub created 2026-04-29 with P5.1 pre-loaded

## Severity scheme

- P0: Blocking, must fix before any external demo
- P1: Visible but workaroundable, fix this week
- P2: Nice-to-have, fix eventually
- P3: Logged for awareness only

## Summary findings

### Audit 1 (Data Integrity) — completed 2026-04-28

- 0 P0, 3 P1 (all resolved in-session), 7 P2 (5 resolved + 1 escalated + 1 open), 2 P3
- All three P1 items closed: LACERA Meketa aggregate-line bug, TRS Texas FY23 staleness, NYSCRF Aksia mandate-split
- P2.6 (LACERA re-extraction) ESCALATED with concrete 7-firm gap + UI mitigation; full re-extraction queued for next consultant-extraction iteration
- P2.7 (no `fee_period` column) cross-referenced to Audit 4

### Audit 2 (Code Quality) — completed 2026-04-29

- 0 P0, 0 P1, 3 P2, 4 P3
- Codebase fundamentally clean: no TODO/FIXME, no SQL injection patterns, no insecure env fallbacks
- All P2s are classifier-prompt or schema-companion findings cross-referenced to Audit 1
- Test suite absence flagged for Audit 5

### Audit 3 (Visual / UX) — completed 2026-04-29 (CODE-SIDE ONLY)

- 0 P0, 0 P1, 4 P2, 8 P3
- SCOPE NOTE: Interactive visual walk-through deferred to a separate session before external demo. Code-side review only.
- ~~P2.1, P2.2~~: ~~Missing error.tsx and loading.tsx for pensions/[slug] route (other dashboard routes have these; pensions is the outlier)~~ **RESOLVED 2026-04-29** by Fix 3: error.tsx, loading.tsx, and not-found.tsx all created for pensions/[slug] matching the canonical signals/outreach pattern. Pattern check surfaced new **P2.5**: 9 of 13 dashboard segments still lack the trio (P2 OPEN, follow-up sweep).
- P2.3: source_url not protocol-validated; javascript: scheme would render as clickable
- P2.4: Mobile responsive design effectively absent (1 sm: class in 1,444 lines)
- P3 cluster: empty-state findings, mandate-order coverage gap, tooltip accessibility, invalid-date edge cases, no not-found.tsx, no i18n
- Visual rendering not verified - documented as scope gap requiring follow-up audit

### Audit 4 (Schema / DB) — completed 2026-04-29

- 0 P0, 1 P1, 5 P2, 1 P3
- ~~P4.3 (P1)~~: ~~No Supabase CLI migration tracking — 41 local .sql files, no `supabase_migrations.schema_migrations` table; migrations applied ad-hoc via `scripts/apply-migration.ts`. Blocks parallel dev / branch envs / onboarding.~~ **RESOLVED 2026-04-29**: Supabase CLI adopted, 42 migrations reconciled to tracker via `supabase migration repair --status applied`, schema invariants verified unchanged. Migrations workflow documented in `docs/migrations-workflow.md`.
- P4.1 + P4.2 (P2): fee_period column missing on plan_consultants + code companion gap (cross-ref Audit 1 P2.7 / Audit 2 P2.3). Migration drafted in Sub-audit 4.5; backfill plan included.
- P4.4 (P2): 5 FK columns missing indexes (pension_allocations.source_document_id, plan_consultants.source_document_id, rejected_signals.document_id, signals.document_id, user_profiles.firm_id) — performance impact grows with dataset.
- P4.5 (P2): `gps` table is the only public table with RLS disabled; consistency gap.
- P4.6 (P2): `asset_class` CHECK enum drifts between pension_allocations (9 values) and signals/rejected_signals (6 values) — duplicate CHECK constraints will drift on each new class addition.
- P4.7 (P3): 5 tables with RLS=true and zero policies (intentional deny-all for service-role-only) but undocumented; future engineer might "fix" by adding `using (true)`.
- Schema is structurally sound: 0 orphan rows across 15 FKs, 0 tables without PK, 29 well-designed UNIQUE/CHECK constraints, RLS coverage near-complete.

### Audit 5 (Production Readiness) — completed 2026-04-29

- 0 P0, 3 P1, 6 P2, 3 P3
- P5.1 (P1, pre-loaded): `handle_new_user` trigger hardcodes `role='admin'` — every new signup gets admin by default. Mitigated today by the 3-email allowlist; ships as a real privilege escalation when allowlist widens.
- P5.4 (P1): No error tracking / monitoring (no Sentry / Bugsnag / Datadog). Production errors land in Vercel logs and stay there. Silent failures.
- P5.6 (P1): No test suite — zero `*.test.ts`, no test directories, no test framework deps in `package.json`. Every audit's findings validated by hand; future regressions undetected.
- P5.2 (P2): `SUPABASE_SERVICE_ROLE_KEY` referenced in code but missing from `.env.local.example` (only `SUPABASE_SECRET_KEY` is documented).
- P5.3 (P2): No documented secret rotation procedure.
- ~~P5.5 (P2)~~: ~~No CI / GitHub Actions / pre-commit hooks. `pnpm tsc` and `pnpm lint` not gated on push.~~ **RESOLVED 2026-04-29** by Fix 4: `.github/workflows/ci.yml` runs `pnpm tsc --noEmit` + `pnpm lint` on every push to main and PR. Manual UI step pending (branch protection enable).
- P5.7 (P2): Zero rate limiting anywhere. Cron routes are `CRON_SECRET`-gated; user-facing dashboard routes are not.
- P5.8 (P2): Hardcoded admin email duplicated in 3 files (DRY violation: `(dashboard)/layout.tsx`, `admin/ingestion/page.tsx`, `outreach/page.tsx`).
- P5.10 (P2): No documented backup/restore procedure.
- P5.9 (P3): Hardcoded admin set covers `vitek.vrana@bloorcapital.com` only; secondary owner email `vitek.vrana@mail.utoronto.ca` covered only via `user_profiles.role` fallback.
- P5.11 (P3): No restore drill ever performed.
- P5.12 (P3): Supabase backup tier not verified.
- Strong operational artefact: `vercel.json` configures 16 cron jobs with staggered scheduling and no minute overlap.

---

## Final aggregated findings — across all 5 audits

### Total counts (cumulative across the 5 audits)

| Severity | Surfaced | Resolved in-session | Open / ESCALATED |
|---|---|---|---|
| P0 | 0 | — | **0** |
| P1 | 7 | 3 (Audit 1 P1.1–P1.3) | **4** |
| P2 | 25 | 5 (Audit 1 P2.1–P2.5) + 1 ESCALATED (P2.6) | **19** |
| P3 | 18 | 0 | **18** |
| **Total** | **50** | **9** | **41** |

### Open findings table (all 41 unresolved, severity-ordered)

| ID | Audit | Title | Cross-refs |
|---|---|---|---|
| P4.3 | 4 | No Supabase CLI migration tracking | — |
| P5.1 | 5 | `handle_new_user` privilege escalation | — |
| P5.4 | 5 | No error tracking / monitoring | Audit 2 P3.2 |
| P5.6 | 5 | No test suite | — |
| P1.2 | 1 | TRS Texas FY23 staleness (annotated; awaits new ACFR ingest) | — |
| P2.6 | 1 | LACERA ACFR re-extraction (ESCALATED with 7-firm gap + UI mitigation) | Audit 2 P2.1 |
| P2.7 / P4.1 / P4.2 | 1 / 4 | `fee_period` schema gap (schema + code companion) | Audit 1, 2, 4 |
| P2.1 | 2 | Classifier prompt missing same-row co-occurrence guard | Audit 1 P1.1 |
| P2.2 | 2 | Classifier prompt missing mandate-split guidance | Audit 1 P1.3 |
| P2.3 | 2 | Code-side companion to fee_period gap | Audit 1 P2.7 |
| P3.1 | 2 | 3 pre-existing lint warnings in `explore/` | — |
| P3.2 | 2 | `lib/classifier/index.ts` console.log → structured logger | Audit 5 P5.4 |
| P3.3 | 2 | `ts-prune` not installed | — |
| P3.4 | 2 | Error UX surface not verified (deferred) | Audit 3 |
| P2.1 | 3 | No `error.tsx` for `pensions/[slug]` | Audit 2 P3.4 |
| P2.2 | 3 | No `loading.tsx` for `pensions/[slug]` | Audit 2 P3.4 |
| P2.3 | 3 | `source_url` not protocol-validated | — |
| P2.4 | 3 | Mobile responsive design effectively absent | — |
| P3.A | 3 | Empty-state mailto exposes founder email | — |
| P3.B | 3 | Empty-state branch unreachable from production data | — |
| P3.C | 3 | Empty-state mailto has no fallback | — |
| P3.D | 3 | `CONSULTANT_MANDATE_ORDER` missing 5 of 9 known specialties | — |
| P3.E | 3 | Native `title` tooltip not keyboard accessible | Audit 2 P3.4 |
| P3.F | 3 | `last_verified_at` invalid-date edge case | — |
| P3.G | 3 | Unknown `source_type` falls into "mixed" subtitle | — |
| P3.H | 3 | No `not-found.tsx` for unknown slugs | — |
| P3.I | 3 | All user-facing strings hardcoded en-US | — |
| (visual gap) | 3 | Visual walk-through deferred to separate session | — |
| P4.4 | 4 | 5 FK columns missing indexes | — |
| P4.5 | 4 | `gps` table has RLS disabled | — |
| P4.6 | 4 | `asset_class` CHECK enum drift | — |
| P4.7 | 4 | 5 service-role-only tables undocumented | — |
| P5.2 | 5 | `SUPABASE_SERVICE_ROLE_KEY` env var naming gap | — |
| P5.3 | 5 | No secret rotation procedure | — |
| P5.5 | 5 | No CI / pre-commit hooks | — |
| P5.7 | 5 | No rate limiting | — |
| P5.8 | 5 | Hardcoded admin email DRY violation | — |
| P5.10 | 5 | No documented backup/restore procedure | — |
| P5.9 | 5 | Admin set coverage gap for secondary owner email | — |
| P5.11 | 5 | No restore drill performed | — |
| P5.12 | 5 | Supabase backup tier not verified | — |

### Top 5 priorities for follow-up fix session

| # | Fix | Audit ref | Why first | Est effort |
|---|---|---|---|---|
| **1** | Fix `handle_new_user` trigger to default `role='user'`; demote any non-Vitek admin rows | P5.1 | Live silent privilege escalation; one-line trigger fix; closes the largest auth-model gap | ~30 min |
| **2** | Adopt Supabase CLI migrations or build `applied_migrations` tracking table | P4.3 | Blocks all other schema work from being trackable; foundation for every fix below | ~2 hrs (CLI) or ~1 hr (custom table) |
| **3** | Add Sentry (or equivalent) for error tracking | P5.4 | Silent production errors today; highest leverage — surfacing errors immediately reduces cost of every other risk | ~2 hrs |
| **4** | Add `.github/workflows/ci.yml` running `pnpm tsc --noEmit` + `pnpm lint` | P5.5 | Cheapest CI win; protects against regressions in every audit's findings | ~30 min |
| **5** | Apply `add_fee_period` migration + classifier prompt update + UI rendering update | Audit 1 P2.7 / Audit 2 P2.3 / Audit 4 P4.1+P4.2 | Closes the largest cross-audit cluster (4 findings, 1 fix) | ~3 hrs |

**Total top-5 effort**: ~9 hours across one focused fix session.

### What's now institutional-grade

- **Data integrity** (Audit 1) — 75 plan_consultants rows across 20/20 plans with verifiable source URLs, verbatim excerpts, schedule-scan provenance on the borderline cases, and explicit "ACTIVE BUT DIMINISHED" / "ACTIVE AND STABLE" annotations on the SWIB rows. Zero orphan rows, every fee value traceable to its source.
- **Code quality** (Audit 2) — zero TODO/FIXME, zero SQL injection patterns, zero insecure env fallbacks, no service-role exposure to client, fail-closed env handling.
- **Schema correctness** (Audit 4) — zero orphan rows, every table has a primary key, 29 well-designed UNIQUE/CHECK constraints, RLS coverage near-complete (16 of 17 tables enabled). The `plan_consultants_unique_mandate_year` UNIQUE NULLS NOT DISTINCT constraint correctly handles the multi-year-duplicate semantics.
- **Cron operational hygiene** (Audit 5 surface finding) — `vercel.json` 16 cron jobs staggered across morning UTC with no minute overlap.
- **Audit infrastructure** — `scripts/audit-acfr-firm-scan.ts` is reusable across future fee-verification work; the institutional standard documented in this audit pass (Reproducibility metadata, Scope limitations, P0–P3 severity, pattern-check sub-audits, resolution tracking) is repeatable.

### What still needs work

- **Authorization model** — silent privilege escalation by default (P5.1) plus hardcoded admin DRY violations (P5.8) plus secondary email coverage gap (P5.9) make the auth surface "secure by allowlist" rather than secure by design. Top-priority fix.
- **Operational visibility** — no error tracking (P5.4), no test suite (P5.6), no CI (P5.5). Each amplifies risks from earlier audits.
- **Mobile / responsive UX** — P2.4: 1 `sm:` class in 1,444 lines of `pensions/[slug]/page.tsx`. Desktop-only. Visual walk-through deferred.
- **Schema operational hardening** — migration tracking (P4.3), missing indexes (P4.4), `gps` RLS (P4.5), asset_class enum drift (P4.6).
- **Production readiness baseline** — secret rotation procedures (P5.3), rate limiting (P5.7), backup/restore docs (P5.10).
- **Long-tail UI polish** — error.tsx / loading.tsx / not-found.tsx for `pensions/[slug]` (Audit 3 P2.1, P2.2, P3.H), tooltip accessibility (P3.E), empty-state findings (P3.A/B/C).
