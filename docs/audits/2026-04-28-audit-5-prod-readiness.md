# Audit 5 — Production Readiness (2026-04-28)

## Reproducibility metadata

| Field | Value |
|---|---|
| Audit performed | 2026-04-29 (continued from Audits 1-4) |
| Commit hash at audit start | `13b4c19` |
| Database snapshot | production state as of 2026-04-29 |
| Auditor | Vitek Vrana (with assistance from Claude) |
| Methodology | 8 sub-audits + 1 cross-audit pattern check |
| Tooling | grep, ripgrep, file inventory, Vercel/Supabase config inspection |

## Scope limitations

This audit examines:

- Environment variable inventory and configuration
- Secret management (committed/uncommitted, rotation readiness)
- Deploy pipeline configuration
- Monitoring and observability stack
- Rate limiting and DoS protection
- Test coverage and CI configuration
- Authorization model (cross-references P5.1 already loaded)
- Backup/disaster-recovery readiness

This audit does **not** examine:

- Load testing or performance benchmarking
- Cost optimization (DB pricing, vendor billing)
- Compliance certifications (SOC 2, HIPAA, GDPR audit trail)
- Penetration testing or active security assessment
- Disaster recovery drills (theoretical readiness only)
- Vendor SLA review (Supabase, Vercel uptime contracts)
- Network-level security (WAF, DDoS mitigation at edge)

## Summary

| Severity | Count | Open |
|---|---|---|
| P0 | 0 | 0 |
| P1 | 3 | **2** (P5.1 RESOLVED 2026-04-29) |
| P2 | 6 | **5** (P5.5 RESOLVED 2026-04-29) |
| P3 | 3 | 3 |

P0: none. **P1: three** — P5.1 (pre-loaded handle_new_user
privilege escalation), P5.4 (no error tracking / monitoring —
silent production errors), P5.6 (no test suite). All three
were pre-categorized as P1 in the audit's scoping
instructions; none is a surprise. **P2: six** — env var
documentation gap, no documented secret rotation, no CI /
pre-commit hooks, no rate limiting, hardcoded admin email DRY
violation, no documented backup/restore procedure. **P3:
three** — admin email coverage gap, no restore drill, reliance
on managed Supabase backups without verification.

Audit 5 covers production readiness, environment configuration,
secret management, deployment pipeline, monitoring, rate
limiting, and authorization model. Findings pre-loaded from
cross-audit work in Audits 1-4 are listed below; Audit 5 added
direct findings on top.

## Pre-loaded findings (from cross-audit work)

### P5.1 (pre-loaded from Audit 2 housekeeping) — Silent privilege escalation by default in `handle_new_user` trigger

Surfaced during Day 17 Audit 2 housekeeping (Nicholas Cheung
signup investigation). The `handle_new_user()` AFTER INSERT
trigger on `auth.users` hardcodes `role = 'admin'` regardless
of the `user_profiles.role` column default (`'user'`):

```sql
insert into public.user_profiles (id, email, role)
values (new.id, new.email, 'admin')
on conflict (id) do nothing;
```

Effect: any email added to `public.allowed_emails` who completes
Supabase signup automatically receives admin role. The schema's
`'user'` default never fires because the trigger explicitly
writes `'admin'`. Contradicts principle of least privilege.

Risk severity context: Allocus is gated to a small allowlist
today (3 emails: 2 owner + 1 tester), so no external risk yet.
However, the bug ships with any future widening of the
allowlist or transition to open signup.

**Severity: P1.** Visible default-state issue with security
implications. Resolution: schema migration to flip
`handle_new_user` default from `'admin'` to `'user'` (or remove
the role assignment entirely and let the column default fire).
Existing admin rows for owners explicitly preserved.

**Resolution (2026-04-29)**: applied migration
`20260429000001_fix_handle_new_user_default_role.sql` which
rewrites `public.handle_new_user()` to insert with
`role = 'user'` (matching the column default) instead of the
hardcoded `'admin'`. New signups will now receive least-
privilege access by default. Existing admin assignments for
owner accounts (`vitek.vrana@bloorcapital.com` and
`vitek.vrana@mail.utoronto.ca`) preserved unchanged. Verified
by post-migration query: function body no longer contains the
`'admin'` literal, and all 3 existing `user_profiles` rows
(Vitek primary, Vitek secondary, Nicholas) are unchanged from
their pre-migration state.

Pattern check confirmed the bug source was isolated to
`handle_new_user`: only 1 PG function across `public` and
`auth` schemas referenced `'admin'`; only 1 SQL migration line
hardcoded the role assignment (the predecessor migration
`20260421000003_auth_triggers.sql:49` that this migration
supersedes); zero TS/TSX files set `role='admin'` (the 3 hits
in `app/(dashboard)/layout.tsx`,
`app/(dashboard)/admin/ingestion/page.tsx`, and
`app/(dashboard)/outreach/page.tsx` only READ the role for
gating, tracked separately as P5.8).

**Status: RESOLVED.**

## Findings (Audit 5 direct)

### Sub-audit 5.1 — Environment variable inventory

10 `process.env.*` references in code:

| Var | Type | In `.env.local.example`? | Has fallback in code? |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | secret | yes | no (fail-closed) |
| `CRON_SECRET` | secret | yes | no (fail-closed) |
| `NEXT_PUBLIC_SITE_URL` | public | yes (default `http://localhost:3000`) | yes |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | public | yes | no (fail-closed) |
| `NEXT_PUBLIC_SUPABASE_URL` | public | yes | no (fail-closed) |
| `RESEND_API_KEY` | secret | yes | no (fail-closed) |
| `SUPABASE_DB_URL` | secret | yes | no (fail-closed) |
| `SUPABASE_SECRET_KEY` | secret | yes | no (fail-closed) |
| **`SUPABASE_SERVICE_ROLE_KEY`** | secret | **NO** | unknown |
| `VERCEL` | runtime flag | n/a (Vercel-set) | n/a |

`.env.local` is gitignored (verified). No env files tracked
in git. `.env.local.example` is the only committed env file
and contains zero actual values — clean.

#### P5.2 — `SUPABASE_SERVICE_ROLE_KEY` referenced in code but missing from `.env.local.example`

The example file documents `SUPABASE_SECRET_KEY` (with a
comment noting it's the new name; "formerly 'service_role'
key"). However, code still references both
`SUPABASE_SECRET_KEY` and `SUPABASE_SERVICE_ROLE_KEY`. New
deployments setting up env vars from the example would miss
`SUPABASE_SERVICE_ROLE_KEY`, which would silently break
whatever code path still uses the old name.

Resolution: either consolidate code to one canonical name
(`SUPABASE_SECRET_KEY`) and delete legacy references, OR
document both in the example with a note that they must hold
the same value during the migration period.

**Severity: P2.** **Status: OPEN.**

### Sub-audit 5.2 — Secret rotation readiness

Rotatable secrets in env (all non-public):

- `ANTHROPIC_API_KEY` — Anthropic console issuer; per-token
  billing → high rotation value
- `CRON_SECRET` — gates cron write paths; rotation invalidates
  in-flight cron requests
- `RESEND_API_KEY` — email delivery; rotation low-impact
- `SUPABASE_DB_URL` — direct Postgres connection string;
  rotation requires DB password reset
- `SUPABASE_SECRET_KEY` / `SUPABASE_SERVICE_ROLE_KEY` —
  service-role auth; rotation in Supabase dashboard

**No rotation procedure documented** in `docs/`. No checks for
last-rotation date, no calendar reminder, no playbook for
emergency rotation (e.g., if Anthropic key leaks).

#### P5.3 — No documented secret rotation procedure

**Severity: P2.** **Status: OPEN.** Recommended: a brief
`docs/secret-rotation.md` listing each secret, its issuer, the
rotation steps in the issuer dashboard, the Vercel env var
update, and a verification step (deploy + smoke check).

### Sub-audit 5.3 — Deploy pipeline

- **`vercel.json`** — well-configured: 16 cron jobs across
  classify / scrapers / health-check, schedules staggered
  across morning UTC hours with no minute overlap. Operational
  hygiene is strong.
- **`package.json` scripts**: `dev`, `build`, `start`, `lint`,
  `typecheck`, `scrape:calpers`. **No `test` script.**
- **`.github/workflows/`** — does **not exist**. No GitHub
  Actions CI.
- **`.husky/`** — does **not exist**. No pre-commit hooks.
- **`lint-staged`** — not configured.
- **Branch protection**: local config shows
  `branch.main.remote=origin` only. No local protection
  visible. Remote (GitHub) protection unknown but the Claude
  Code permission rule blocking direct push to main suggests
  there's at least an organizational expectation of PR review.

#### P5.5 — No CI / pre-commit hooks / lint-staged

`pnpm tsc --noEmit` and `pnpm lint` are not gated on any
push, PR, or commit. A typo, lint regression, or type error
can land on `main` if a developer forgets to run the local
checks. **Severity: P2.** **Status: OPEN.** Cheapest fix: a
`.github/workflows/ci.yml` running `pnpm install`, `pnpm tsc
--noEmit`, `pnpm lint` on every push and PR. ~10-line file.

A `husky + lint-staged` pre-commit hook would also help but
is secondary to CI.

**Resolution (2026-04-29)**: GitHub Actions CI workflow added
at `.github/workflows/ci.yml`. Runs on every push to `main`
and on every PR targeting `main`. Steps: checkout → setup
pnpm 10.33.0 (matches `packageManager` field in
`package.json`) → setup Node 20 LTS (matches Vercel's deploy
runtime) with pnpm cache → `pnpm install --frozen-lockfile`
(prevents version drift between local and CI) → `pnpm tsc
--noEmit` → `pnpm lint`.

The 3 pre-existing lint warnings in `explore/` (Audit 2 P3.1)
are warnings, not errors — `pnpm lint` exits 0 with them
present, so CI will pass green. Verified locally before
shipping.

**Branch protection enforcement deferred (2026-04-29)**:
Manual UI step at GitHub repository settings was attempted
but the CI status check did not appear in the protection
dropdown (likely because of timing — dropdown population
requires CI to have completed at least one run, and
enforcement was attempted before this happened, or the
dropdown took longer to populate than expected). The CI
workflow itself runs on every push and reports status;
enforcement (blocking merges on CI failure) is a
nice-to-have that becomes important when:

- A second developer joins the project
- Compliance or audit requirements emerge
- PR-based workflow is adopted

None of these conditions apply today (solo developer, 3
users, internal tool). The enforcement step is logged as
a P3-equivalent backlog item to revisit when conditions
change.

A `husky + lint-staged` pre-commit hook is **not** included
in this fix — secondary to CI per the original finding, and
introduces a developer-side dependency that some workflows
prefer to avoid. Logged for future consideration.

Audit ref status: P5.5 RESOLVED for the CI workflow itself;
enforcement-via-branch-protection deferred.

**Status: RESOLVED.**

### Sub-audit 5.4 — Monitoring and observability

- **No monitoring SDKs** in `package.json` (Sentry, Bugsnag,
  Datadog, LogRocket, Axiom, PostHog, Mixpanel,
  OpenTelemetry, etc. — all absent)
- **No error tracking integration** in code
- **15 `console.error/warn` calls** in app/lib/middleware —
  these write to Vercel runtime logs but require manual
  inspection to surface
- No uptime monitoring beyond
  `app/api/cron/scraper-health-check/route.ts` (which tracks
  scraper-specific health, not overall app uptime)

#### P5.4 — No error tracking / monitoring (silent production errors) — pre-categorized P1

Production errors land in Vercel logs and stay there. No
alerting, no aggregation, no error rate visibility, no triage
queue. For a paid SaaS-aspiration product this is a P1.

**Severity: P1.** **Status: OPEN.** Cheapest fix: integrate
Sentry (free tier covers small teams), wire in Next.js error
boundary + server-side handler, enable cron job error
notifications.

### Sub-audit 5.5 — Rate limiting and DoS protection

- **Zero rate limiting** anywhere in the codebase
- No `@upstash/ratelimit`, `next-rate-limit`, or similar
- No brute-force protection (mitigated by allowlist for now)
- No CAPTCHA / anti-bot (mitigated by allowlist for now)

Cron routes are `CRON_SECRET`-gated (good), but user-facing
dashboard routes have no rate limiting.

#### P5.7 — No rate limiting on user-facing routes

Possibly exploitable for read-only DoS via the dashboard
pages. Mitigated today by the small allowlist (3 emails) but
ships as a real concern when the allowlist widens or external
demos open the door. **Severity: P2.** **Status: OPEN.**

Recommended: `@upstash/ratelimit` on the `(dashboard)/*`
routes, gated by user_id from the auth session. ~30-line
middleware addition.

### Sub-audit 5.6 — Test coverage and CI

- **Zero test files** (no `*.test.ts`, `*.test.tsx`,
  `*.spec.ts`, `*.spec.tsx`)
- **No test directories** (`__tests__/`, `tests/`, `e2e/`
  all absent)
- **No test scripts** in `package.json`
- **No test framework deps** (no Jest, Vitest, Playwright,
  Cypress, @testing-library/*)

#### P5.6 — No test suite — pre-categorized P1

Every audit's findings are validated by hand. Future
regressions undetected. Cross-referenced from Audit 2 (Code
Quality) and Audit 4 (Schema). **Severity: P1.** **Status:
OPEN.**

Resolution priorities (lowest cost first):

1. **Vitest + Testing Library** for unit tests on
   `lib/classifier/`, `lib/utils.ts`, and the small set of
   pure-logic helpers in `app/(dashboard)/pensions/[slug]/page.tsx`
   (subtitle case detection, mandate sort, format helpers).
2. **Playwright** for one smoke test per major route
   (`/signals`, `/pensions/calpers`, `/explore`,
   `/outreach`).
3. **CI workflow** (P5.5) running both on every push.

### Sub-audit 5.7 — Authorization model

P5.1 (pre-loaded) covered the silent privilege escalation in
`handle_new_user`. Three additional findings from the
role-gating code review:

#### P5.8 — Hardcoded admin email duplicated in 3 files (DRY violation)

`isAdmin` check pattern appears in:

- `app/(dashboard)/layout.tsx` — `["vitek.vrana@bloorcapital.com"]`
- `app/(dashboard)/admin/ingestion/page.tsx` — `ADMIN_EMAILS` set (likely same)
- `app/(dashboard)/outreach/page.tsx` — `ADMIN_EMAILS` set

Each location maintains its own list. If the canonical admin
email changes, three places need updating. Recommended: lift
to a single `lib/auth/admin-emails.ts` module exporting the
canonical set + a helper `isAdmin(user, profile)`.

**Severity: P2.** **Status: OPEN.**

#### P5.9 — Admin set covers `vitek.vrana@bloorcapital.com` only; secondary owner email missed by hardcoded path

`allowed_emails` and `user_profiles` both include
`vitek.vrana@mail.utoronto.ca` (owner / secondary), but the
hardcoded `adminEmails` set in
`app/(dashboard)/layout.tsx` contains only the primary
`@bloorcapital.com` email. The secondary email DOES get admin
via `userProfile?.role === "admin"` (because every signup
defaults to admin per P5.1), but the hardcoded
defense-in-depth path doesn't apply to it.

Two ways to fix:

- Extend the hardcoded set to include both owner emails (also
  resolves part of P5.8 if consolidating)
- Drop the hardcoded path entirely once P5.1 is fixed
  (handle_new_user defaults to `user`, then explicitly
  promote `vitek.vrana@*` rows to admin) and rely on
  `user_profiles.role === 'admin'` as the single source

**Severity: P3.** **Status: OPEN.** Defense-in-depth gap, not
a live security defect (admin still works via the role check
fallback).

### Sub-audit 5.8 — Backup and disaster recovery

- **No backup/restore scripts** in repo
- **No DR plan** in `docs/`
- Reliance on Supabase managed backups (project tier
  dependent — verification not done)

#### P5.10 — No documented backup/restore procedure

A founder-out-sick / data-loss scenario today has no playbook.
**Severity: P2.** **Status: OPEN.** Recommended:
`docs/backup-restore.md` listing the Supabase project tier's
backup retention, the steps to trigger a manual snapshot
before risky migrations, and the restore procedure (Supabase
dashboard → Database → Backups → Restore).

#### P5.11 — No restore drill ever performed

Reliance on managed backups without verification. Theoretical
readiness only. **Severity: P3.** **Status: OPEN.**

#### P5.12 — Supabase backup tier not verified

Project plan / backup retention not documented. Could be
default 7-day rolling window or could be longer; unverified.
**Severity: P3.** **Status: OPEN.**

---

## Sub-audit 5.9 — Pattern check / cross-audit amplification

Production-readiness gaps amplify findings from earlier
audits. The most consequential interactions:

| Audit gap (Audit 5) | Amplifies | Effect |
|---|---|---|
| **P5.4 no monitoring** | Audit 1 data integrity regressions | Silent for hours/days; only caught on next manual audit pass |
| **P5.6 no tests** | Audit 2 code quality regressions | Refactors land with no safety net; Audit 1's NULL-fee logic could be silently inverted |
| **P5.5 no CI** | Audit 2 baseline (tsc, lint clean) | Future commits can introduce TS errors or lint regressions without surfacing |
| **P5.7 no rate limiting** | Audit 4 RLS coverage | RLS protects rows, not request volume; the 5 service-role-only tables (Audit 4 P4.7) become more attractive targets without rate limits |
| **Audit 4 P4.3 migration tracking + P5.5 no CI** | Schema drift between local / staging / prod | Migration applied locally without push, undetected for days |
| **P5.1 + P5.8 + P5.9 admin model** | Audit 4 P4.7 service-role tables | Privilege escalation by default + hardcoded admin DRY + secondary email gap together create a brittle authorization surface that's only "secure by allowlist" — not by design |

The single highest-leverage fix that benefits the most other
audits is **P5.4 (monitoring)**: surfacing errors in
production immediately reduces the cost of every other risk in
the audit pass.

---

## Recommended next steps

### Top 5 priorities for follow-up fix session

| # | Fix | Audit ref | Why first |
|---|---|---|---|
| 1 | Fix `handle_new_user` trigger to default `role = 'user'`; demote any non-Vitek admin rows | P5.1 | Live silent privilege escalation; one-line trigger fix |
| 2 | Adopt Supabase CLI migrations or build `applied_migrations` tracking | Audit 4 P4.3 | Blocks all other schema work from being trackable |
| 3 | Add Sentry (or equivalent) for error tracking | P5.4 | Silent production errors today; highest leverage |
| 4 | Add `.github/workflows/ci.yml` running tsc + lint | P5.5 | Cheapest CI win; protects against regressions |
| 5 | Apply `add_fee_period` migration + classifier prompt + UI update | Audit 1 P2.7 / Audit 2 P2.3 / Audit 4 P4.1+4.2+4.5 | Closes the largest cross-audit cluster in one session |

### All recommended fixes (severity-ordered)

**P1 (block external demo)**:
1. P5.1 — `handle_new_user` privilege escalation fix
2. P5.4 — error tracking / monitoring integration
3. P5.6 — minimum viable test suite (Vitest + Playwright + CI)

**P2 (this week / month)**:
1. P5.2 — reconcile `SUPABASE_SERVICE_ROLE_KEY` ↔
   `SUPABASE_SECRET_KEY` env var naming
2. P5.3 — document secret rotation procedure
3. P5.5 — CI workflow + pre-commit hooks
4. P5.7 — rate limiting on user-facing routes
5. P5.8 — consolidate hardcoded admin emails to one module
6. P5.10 — document backup/restore procedure

**P3 (logged for awareness)**:
1. P5.9 — admin set coverage gap for secondary owner email
2. P5.11 — restore drill not performed
3. P5.12 — Supabase backup tier not verified

### What blocks external demo vs. eventually needed

**Blocks**:
- P5.1 (every external user becomes admin on signup)
- P5.4 (no error visibility — first prod outage will be unsurfaced)
- P5.6 (no tests = high regression risk during demo prep churn)

**Eventually needed**:
- All P2/P3 items above. None are blocking but each compounds
  the cost of running the platform at scale.
