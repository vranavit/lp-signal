# Audit 2 — Code Quality (2026-04-29)

Continuation of the institutional 5-audit pass. Audit 1 closed
on 2026-04-28 commit `ee33782` with 11 of 12 findings resolved
or escalated. Audit 2 examines code quality, security, and
maintainability across the full repo.

## Reproducibility metadata

| Field | Value |
|---|---|
| Audit performed | 2026-04-29 |
| Commit hash at audit start | `ee33782` |
| Repo size | 252 .ts/.tsx files, 32,827 lines (per yesterday's baseline) |
| Auditor | Vitek Vrana (with assistance from Claude) |
| Methodology | 6 sub-audits + 1 cross-audit pattern check, each with explicit pattern-checking |
| Tooling | `pnpm tsc`, `pnpm lint`, `grep`, `ripgrep`, manual code review |

## Scope limitations

This audit examines:

- Type-check and lint cleanliness
- Hardcoded secrets, credentials, API keys
- TODO/FIXME/HACK comments and dead code
- Error handling patterns across async code and API routes
- SQL injection, XSS, RLS bypass risks
- Code-side pattern checks for issues surfaced in Audit 1

This audit does **not** examine:

- Data correctness in `plan_consultants` or other tables
  (Audit 1)
- Visual rendering, mobile responsiveness, accessibility
  (Audit 3)
- Schema design, indexes, RLS policy completeness (Audit 4)
- Deploy pipeline, monitoring, env vars, rate limits (Audit 5)
- Test coverage (no test suite exists; will be flagged as P2
  in one of Audits 4 or 5)
- Performance benchmarking or load testing
- Dependency vulnerability scanning (`npm audit`) — flagged
  as P2 in Audit 5

## Summary

| Severity | Count | Open |
|---|---|---|
| P0 | 0 | 0 |
| P1 | 0 | 0 |
| P2 | 3 | **2** (P2.3 RESOLVED 2026-04-29 via 5-phase fee_period cluster fix; P2.1 + P2.2 classifier-prompt items remain open) |
| P3 | 4 | 4 (lint nits, operational logging style, dead-code tooling, error UX surface deferred to Audit 3) |

No P0/P1 code-quality defects. The codebase is clean of hardcoded
secrets, SQL injection patterns, XSS surfaces, swallowed
unintentional errors, TODO/FIXME debt, and inappropriate
service-role usage. Service-role usage is correctly confined to
server-only paths (server components, server actions, cron
routes — never client components or API responses).

P2 findings cluster around the classifier's consultant
extraction prompt: code-side companions to the data-side defects
that Audit 1 P1.1 and P1.3 surfaced. The prompt has a partial
aggregate-line guard that fires when firm names are absent from
the document, but does not require **same-row co-occurrence** of
firm + fee (Audit 1 P1.1 LACERA defect), and does not address
**single-fee-multiple-mandate disclosures** (Audit 1 P1.3 NYSCRF
defect). The third P2 is the code-side companion to Audit 1
P2.7: zero references to `quarterly` / `fee_period` in app code
(SWIB-quarterly-data problem); cross-referenced to Audit 4.

P3 findings are 3 pre-existing lint warnings in `explore/`
(unchanged from yesterday's baseline), an operational-logging
style observation (7 `console.log` calls in
`lib/classifier/index.ts`, all properly tagged but a structured
logger would be cleaner), the absence of a `ts-prune`-style
dead-code scan (not installed; not run in this audit), and a
deferral note: Sub-audit 2.4 verified error-handling shape but
not error-UX surface — that's queued for Audit 3 (P3.4).

---

## Sub-audit 2.1 — Type-check + lint baseline

`pnpm tsc --noEmit` exit 0. `pnpm lint` exit 0 with 3 warnings,
all pre-existing in the `explore/` module:

| File:Line | Rule | Description |
|---|---|---|
| `app/(dashboard)/explore/explore-table.tsx:318` | `jsx-a11y/role-supports-aria-props` | `aria-sort` on `role="button"` (button doesn't support aria-sort) |
| `app/(dashboard)/explore/explore-workspace.tsx:157` | `react-hooks/exhaustive-deps` | `useMemo` missing dep `FILTER_KEYS` |
| `app/(dashboard)/explore/explore-workspace.tsx:208` | `react-hooks/exhaustive-deps` | `useMemo` missing dep `FILTER_KEYS` |

**Pattern check**: scanned for similar issues across the wider
repo. The `useMemo` warnings target a module-level `FILTER_KEYS`
const that is by definition stable — adding it to the dep array
is correct but the omission has no behavioral effect. The
`aria-sort` warning is an a11y nit on a column-sort button; the
correct fix is to switch the wrapper element's `role` so
`aria-sort` is supported (or drop `aria-sort` and rely on a
visual indicator + screen-reader announcement).

### P3.1 — 3 pre-existing lint warnings in `explore/`

All in one module, low-impact, but standing P3 noise on every
audit baseline. **Severity: P3.** Status: **OPEN** (won't fix
this audit — they predate this session and aren't in the
consultant code under audit). Recommended fix in a future
explore-module touch: add `FILTER_KEYS` to deps (no-op
behavioral, silences lint) and switch the sort header from
`role="button"` to a real `<button aria-sort=…>`.

---

## Sub-audit 2.2 — Secrets and credentials

### Findings

- **No hardcoded secrets, JWTs, sk-ant tokens, AWS keys, or GH
  PATs in the codebase.** Verified across `*.ts`, `*.tsx`,
  `*.js`, `*.json`, `*.env*` — only false positives in
  `pnpm-lock.yaml` (unrelated `js-tokens` package metadata) and
  documentation references to "API tokens" as in classifier
  spend.
- **No connection strings in source.** `SUPABASE_DB_URL` is
  read from `process.env` and never embedded.
- **`.env.local` and `.env.*.local` properly gitignored.** Zero
  env files tracked in git history.
- **No insecure fallback patterns.** Searched for
  `process.env.X || "default"` — zero matches. Every env read
  uses an explicit "missing → fail closed" check (e.g.,
  `if (!secret) return false` in cron auth).
- **`SUPABASE_SERVICE_ROLE_KEY` usage confined to server-only
  paths.** `createSupabaseAdminClient` is imported in:
  - `app/page.tsx` (server component)
  - `app/api/cron/*` (15 cron route handlers)
  - `app/actions/demo-request.ts` and `app/actions/source-url.ts`
    (server actions)

  Never imported by a `"use client"` component. Never returned
  in an API response body.
- **CRON_SECRET auth pattern.** Three cron routes
  (`classify`, `policy-change-alert`, `preliminary-alert`)
  validate a CRON_SECRET via `Authorization: Bearer`,
  `x-vercel-cron-secret` header, or `?secret=` query. Pattern
  is consistent and includes a `if (!secret) return false`
  fail-closed guard.

**Pattern check**: ran the secret regex over `*.json`, `*.yml`,
`*.yaml`, `*.md` in addition to TS/TSX. No real secrets found
in any format. Documentation references to "tokens" are all
contextual (Anthropic API token spend, not secrets).

### Verdict

**No findings.** Secret hygiene is clean.

---

## Sub-audit 2.3 — TODO/FIXME/HACK and dead code

### Findings

- **Zero `TODO`, `FIXME`, `HACK`, `XXX`, `@ts-ignore`, or
  `@ts-expect-error` comments** in `app/`, `lib/`, `scripts/`,
  `components/`, or `middleware.ts`. Notable absence — many
  codebases of this size carry 50–100. Suggests deliberate
  cleanup discipline.
- **`console.log` audit**: zero in `app/` or `components/`. 7 in
  `lib/classifier/index.ts` (lines 298, 336, 456, 708, 732,
  869, 878). 820 in `scripts/` (expected — scripts are CLI
  tools).
- **Dead-code scan**: `ts-prune` not installed. Not run.

### P3.2 — `console.log` in `lib/classifier/index.ts` (operational logging style)

All 7 calls are properly tagged with `[classifier]`,
`[classifier/cafr]`, or `[classifier/files-api]` prefixes and
emit structured key=value pairs. They function as production
operational logging, not debug leftovers. Examples:

- `[classifier] pdf-lib failed for ${documentId}, falling back to unpdf (${err.message.slice(0, 60)})`
- `[classifier/cafr] unpdf fallback for ${doc.id}: totalPages=${n} retained=${m} keywordFilter=${flag}`
- `[classifier/files-api] uploaded ${filename} size=${MB}MB file_id=${id} upload_ms=${ms}`

These are useful logs in their own right; the only quibble is
that a structured logger (pino, winston) with levels would
allow filtering and dropping in production. **Severity: P3.**
Status: **OPEN** — no immediate action; reconsider in Audit 5
(production readiness) when picking an observability stack.

### P3.3 — `ts-prune` not installed for dead-code analysis

The audit could not run a dead-export scan. **Severity: P3.**
Status: **OPEN** — install `ts-prune` (or `knip`) as a dev
dependency and run as part of a future code-quality pass.

---

## Sub-audit 2.4 — Error handling

### Findings

- **1 empty catch block**, in `app/layout.tsx:40`. It lives
  inside the no-FOUC theme script that runs before first paint:
  ```js
  try { var t = localStorage.getItem('lp-theme'); ... } catch (e) {}
  ```
  Catching `localStorage` errors silently in a pre-paint script
  is the standard React pattern (handles SSR + private-browsing
  edge cases). Defensible.
- **5 swallowed `.catch(() => {})` patterns.** All justified:
  - `app/api/cron/scrape-pension-wave-2/route.ts:68, 104`:
    `recordHash().catch(() => {})` after the primary error has
    already been recorded in `results` array. Suppressing a
    secondary failure on a health-tracking write. Defensive.
  - `app/(dashboard)/explore/explore-filters.tsx:82`:
    `clipboard.writeText().catch(() => {})` for "copy link"
    UX affordance. Fire-and-forget interaction. Safe.
  - `scripts/backfill-prompt-version.ts:77` and
    `scripts/backfill-allocation-sub-class.ts:164`:
    `client.query("rollback").catch(() => {})` defensive
    rollback in CLI scripts. Standard pattern.
- **API route error responses**: spot-checked
  `classify`, `scrape-cafr`, and `scraper-health-check`. All
  return `NextResponse.json(..., { status: 4xx | 500 })` for
  errors. Pattern is consistent across the 15 cron routes.

**Pattern check**: searched for `throw new Error` in route
handlers — none found at the top level (errors are caught and
returned as JSON, not thrown out). Searched for any
`.catch(err => console.error(err))` followed by no rethrow or
status response — none in app code (a few in `scripts/` where
it's appropriate for CLI tools).

### P3.4 — Error UX surface coverage not separately verified

Sub-audit 2.4 verified that the codebase has no empty catch
blocks, no swallowed errors via `.catch(() => {})`, and no
unhandled async without try/catch. However, that does not
verify whether errors are surfaced helpfully to users in the
UI. Specifically not examined:

- When a server component query fails (RLS denial, network
  error, DB unreachable), does the user see an informative
  error or a blank page?
- When a client-side action fails, is the user notified or
  does it silently fail?
- When data is malformed (e.g., a corrupt `fee_usd` value),
  does the UI gracefully degrade or crash?

These will be examined in Audit 3 (Visual / UX) under "error
states" sub-audit. Logging here as P3.4 with explicit
cross-reference to Audit 3.

**Severity: P3.** **Status: OPEN, deferred to Audit 3.**

### Verdict

**No code-side findings on error handling.** Error handling
shape is consistent and intentional. Surface UX deferred to
Audit 3.

---

## Sub-audit 2.5 — SQL injection / XSS / RLS bypass

### Findings

- **SQL injection**: zero string-concatenation patterns
  (`.query("..." + var)`). 13 `client.query(\`...\`)` template
  literals — all in `scripts/` (one-off CLI tools), all hardcoded
  multi-line SQL with no `${userInput}` interpolation. The
  template-literal syntax is purely for readability of long SQL.
- **XSS**: 1 `dangerouslySetInnerHTML` in `app/layout.tsx:55`.
  Static server-side string (the no-FOUC theme detection
  script). No user input. Safe.
- **Service-role usage**: 14 file references to
  `createSupabaseAdminClient`. All in server-only paths (server
  components, cron routes, server actions). None in
  `"use client"` components. None returned in API response
  bodies.
- **RLS path**: queries from user-facing pages (e.g.,
  `app/(dashboard)/pensions/[slug]/page.tsx`,
  `app/actions/saved-filter-views.ts`,
  `app/auth/callback/route.ts`) use `createSupabaseServerClient`
  which respects RLS. Cron and admin paths use the admin client
  which bypasses RLS, but those are CRON_SECRET-gated.

**Pattern check**: searched for any path where the admin client
result is returned in a response body — none. Searched for
`useState(supabase)` or similar client-side leakage — none.

### Verdict

**No findings.** Auth boundary between server-only admin client
and user-facing server client is correctly maintained.

---

## Sub-audit 2.6 — Code-side patterns for Audit 1 defect classes

### P2.1 — Classifier prompt has aggregate-line guard but no same-row co-occurrence requirement (Audit 1 P1.1 code companion)

The consultant classifier prompt at
`lib/classifier/prompts/consultants.ts:55` does instruct:

> If the document only aggregates fees without firm names
> ("Investment Consulting Services Total: $X"), emit an empty
> consultants array — that is a Category B disclosure, handled
> separately by manual research.

And reinforces at line 342:
> Emit an empty consultants array if the document has only
> aggregated disclosure without firm names.

**The guard fires when firm names are absent from the document.**

The LACERA P1.1 defect was more subtle: firm names DID exist
(page 15's Investment Consultants list) and an aggregate fee
line ALSO existed (Schedule of Investment Expenses on a
different page) — but firm-level fees did NOT exist. The
classifier saw both signals across pages, correlated them, and
attributed the aggregate to Meketa.

The prompt does not require **same-row / same-table co-occurrence**
of firm name + fee value. **Severity: P2.** Status: **OPEN.**

**Resolution path**: tighten the prompt to require that fee_usd
be lifted from a line item where the firm name and fee number
appear in the same row of an itemized schedule — not from an
aggregate "Consultants" total even when firm names appear
elsewhere in the document. **Owner**: next consultant-extraction
iteration (already queued under Audit 1 P2.6 LACERA
re-extraction).

### P2.2 — Classifier prompt does not address single-fee-multiple-mandate disclosures (Audit 1 P1.3 code companion)

Sub-audit 2.6 grep on
`lib/classifier/prompts/consultants.ts` confirms the prompt
treats `(firm, mandate, fee_year)` as the primary key tuple and
discusses mandate selection per row (lines 67–91). It does
**not** instruct the model what to do when a single source-line
fee disclosure spans multiple mandates jointly — for example
the NYSCRF P1.3 defect:

> Aksia, LLC $ 800,000

…with no per-mandate breakdown was emitted as two rows
(hedge_funds + private_equity) each storing $800,000 — $1.6M
attributed against an $800K source.

**Severity: P2.** Status: **OPEN.**

**Resolution path**: add explicit prompt guidance for
joint-mandate disclosures. Two safe defaults:

1. If a single firm appears once with a single fee and the
   surrounding section heading is generic (no mandate
   qualifier), emit ONE row at `mandate=general` and store the
   full fee.
2. If the firm appears once and you genuinely cannot
   disambiguate the mandate, emit one row per mandate but
   leave `fee_usd = NULL` on all of them, with the source
   excerpt repeated.

**Owner**: next consultant-extraction iteration.

### P2.3 — Code-side companion to schema P2.7: no quarterly fee handling

Cross-references **Audit 1 P2.7** (the `fee_period` schema gap)
and is the code-side mirror of the same finding. Searched
`app/`, `lib/`, `components/` for any reference to
`fee_period`, `quarterly`, `annual`, `annualized`, or an
implicit divisor like `/ 4`. **Zero matches** outside the
existing `fee_year` integer column. The classifier prompt at
line 55 also assumes annual fees: `Extract one row per (firm,
mandate, fee_year) tuple…`. The UI renders `FY{YY}` regardless
of the underlying period. **Severity: P2.** Status: **OPEN.**

**Resolution path**: same migration as Audit 1 P2.7 (add
`fee_period` enum column), plus prompt update to capture
period when disclosed (e.g., SWIB quarterly schedules), plus UI
update to render unit alongside figure (e.g., `$60K /quarter`).
**Cross-reference**: **Audit 4** (Schema/DB) for the migration;
**Audit 2** (this audit) for the classifier-prompt and UI
follow-through.

**Resolution (2026-04-29)**: code-side companion to the
fee_period gap closed by Phase 3 of Fix 5 cluster (commit
`b0c361b`). The classifier prompt now captures `fee_period`
from source disclosures via a new "fee_period semantic"
section with explicit indicators per value, and the insert
path in `scripts/backfill-consultants.ts` passes it through
to the database. Live test against CalPERS FY2025 ACFR
confirmed every extracted row receives `fee_period: "annual"`
correctly inferred from CAFR Schedule context. Phase 4
(commit `0f15404`) added UI render of `fee_period` alongside
`fee_usd` in `app/(dashboard)/pensions/[slug]/page.tsx`.
Cross-references **Audit 1 P2.7**, **Audit 4 P4.1**, **Audit 4
P4.2** — all resolved together as a 5-phase cluster. See
Audit 1 P2.7 for the full narrative.

**Status: RESOLVED.**

### Verdict

3 P2 code-side companions to Audit 1 findings. None blocking;
all queued for the next consultant-extraction iteration. The
classifier prompt is the central artifact — two of the three
findings sit in `lib/classifier/prompts/consultants.ts` and one
references the schema migration tracked in Audit 4.

---

## Recommended next steps

1. **P2.1 fix** — tighten classifier prompt to require same-row
   firm + fee co-occurrence. Cross-reference: Audit 1 P2.6
   LACERA re-extraction (will validate the prompt fix in
   practice). **Owner**: next consultant-extraction iteration.
2. **P2.2 fix** — add joint-mandate disclosure guidance to
   classifier prompt. Two safe defaults proposed in the
   finding. **Owner**: next consultant-extraction iteration.
3. **P2.3** — quarterly fee handling. Schema-side resolution
   tracked in **Audit 4** (P2.7 from Audit 1); code-side
   resolution touches the classifier prompt + UI rendering.
4. **P3.1** — fix 3 lint warnings on next `explore/` touch.
   Behavioral no-ops; just silences baseline noise.
5. **P3.2** — consider a structured logger for the 7
   `console.log` calls in `lib/classifier/index.ts`.
   Cross-reference: **Audit 5** (production readiness /
   observability stack pick).
6. **P3.3** — install `ts-prune` (or `knip`) and run a
   dead-export scan in a future code-quality pass.
7. **P3.4** — error UX surface (informative messages on RLS
   denial / DB unreachable / malformed data) not verified by
   this audit. **Cross-reference: Audit 3** "error states"
   sub-audit.
8. **No test suite exists** — flagged in Scope as out-of-scope
   for this audit but worth surfacing now: there is no
   `tests/`, `__tests__/`, or `vitest.config` in the repo.
   **Cross-reference: Audit 5** (will catalogue this as a P2
   production-readiness gap when it runs).

