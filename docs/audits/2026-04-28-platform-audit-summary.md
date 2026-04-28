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
