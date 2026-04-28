# Audit 1 — Data Integrity (2026-04-28)

## Reproducibility metadata

| Field | Value |
|---|---|
| Audit performed | 2026-04-28 |
| Commit hash at audit start | `f076118` |
| Database snapshot | production state as of 2026-04-28 |
| Auditor | Vitek Vrana (with assistance from Claude) |
| Methodology | 5 sub-audits (random sample, source integrity, master-list orphans, conflict detection, stale data) plus 1 systematic pattern check (Sub-audit 1.6) |
| Tooling | Node.js `pg` client for DB queries; `unpdf` via `scripts/audit-acfr-firm-scan.ts` for ACFR PDF schedule scanning |

## Scope limitations

This audit examined:

- The 75 `plan_consultants` rows and their source provenance
  (URLs, excerpts, document IDs)
- The 18-row `consultants` master list
- The joined `documents` rows that source CAFR-extracted entries
- Pattern checks for systemic extraction defects
  (aggregate-line capture, shared-excerpt-across-rows,
  round-thousand fee outliers)
- Period basis verification for SWIB Board packet disclosures
  (quarterly vs annual)

This audit did **not** examine:

- Whether `canonical_name` resolution is correct for every firm
  (e.g., merger histories, brand changes — "Aksia" vs
  "Aksia-TorreyCove")
- Whether `mandate_type` assignments are correct in cases where
  the schema enum doesn't perfectly match the source disclosure
  (e.g., private_credit forced into `'other'` for Florida SBA
  Aksia)
- Whether source URLs will remain live in 6+ months (link rot
  risk, especially for press articles)
- Row-level access controls (RLS audit happens in Audit 4 and
  should be cross-referenced)
- Schema design beyond the `fee_period` gap surfaced in P2.7
  (Audit 4 will conduct a comprehensive schema review)
- Code quality, error handling, security risks (Audit 2)
- Visual rendering, mobile responsiveness, empty states
  (Audit 3)
- Production readiness, monitoring, secrets handling (Audit 5)

## Scope

The 75 `plan_consultants` rows shipped on commit `f076118`,
plus the 18-row `consultants` master list and the joined
`documents` rows that source each CAFR-extracted entry.

## Summary

| Severity | Count | Open |
|---|---|---|
| P0 | 0 | 0 |
| P1 | 3 | **0 (all resolved 2026-04-28)** |
| P2 | 7 | **1** (P2.1–P2.5 resolved 2026-04-28; P2.6 ESCALATED with concrete 7-firm gap + UI mitigation; only P2.7 schema gap remains open, cross-referenced to Audit 4) |
| P3 | 2 | 2 |

No blocking integrity defects. All three P1 items resolved in-
session: P1.1 (LACERA Meketa aggregate, fees NULLed), P1.2 (TRS
Texas FY23 staleness, rows annotated), P1.3 (NYSCRF Aksia
single-source / two-mandates fee duplication, fees NULLed).
Same defect family across P1.1 and P1.3 — unresolvable fee
aggregation captured under different mechanisms (firm-split for
LACERA, mandate-split for NYSCRF).

P2.1, P2.2 closed via full ACFR schedule scan against the source
PDFs (CalSTRS RVK and NYSTRS Meketa fees confirmed as full
firm-level retainers, not partial slices). P2.3 reframed off the
discovered joint-mandate / single-quarter context in the SWIB
StepStone excerpt (no $56K backfill — would have replicated the
P1.3 defect). P2.4 + P2.5 closed by primary-source upgrade to
the SWIB Board of June 12 2024 packet, replacing the
marketsgroup.org third-party citation; supplementary deep-scan
established quarterly period basis and ACTIVE-BUT-DIMINISHED PE
engagement. P2.6 ESCALATED — Phase 5 quick scan identified the 7
specific LACERA Investment Consultants missing from
`plan_consultants` (Altus, Campbell Lutyens, Evercore, Jefferies,
Kroll, Albourne, StepStone), and a per-plan UI disclosure note
was added to `/pensions/lacera` to surface the gap to readers
while the full re-extraction is deferred to the next
consultant-extraction iteration. The SWIB deep-scan surfaced one
new finding — **P2.7**, a schema gap (no `fee_period` column to
distinguish quarterly vs annual fees) cross-referenced to Audit
4. Only **P2.7** remains open in the audit doc proper; **P2.6**
is ESCALATED (concretely characterized, UI-mitigated, owner +
timeline assigned). A new P2 (P2.6) was also added off the LACERA fix to
re-extract that ACFR with a firm-listing prompt and surface the
missing co-consultants the aggregate "Consultants" line implies
exist. P2 items also cluster around three CAFR fees that look
low for AUM, plus two Wisconsin SWIB rows sharing a non-targeted
source excerpt and a missed fee value.

---

## Sub-audit 1.1 — 10 random row spot-check

Random sample drawn with `order by random() limit 10`. Per-row
findings below.

| # | Plan | Firm | Mandate | Source type | Verdict |
|---|---|---|---|---|---|
| 1 | Massachusetts PRIM | Hamilton Lane | PE | cafr | OK |
| 2 | LACERA | Meketa | general | cafr | **P1** — fee may be aggregate |
| 3 | Wisconsin SWIB | StepStone | PE | manual | **P2** — fee in excerpt not captured |
| 4 | Oregon PERS | Meketa | general | manual | OK |
| 5 | CalSTRS | RVK | general | cafr | **P2** — fee implausibly low |
| 6 | NYSCRF | RVK | general | cafr | OK |
| 7 | Wisconsin SWIB | StepStone | real_estate | manual | **P2** — duplicates row 3 excerpt |
| 8 | NYSTRS | Meketa | general | cafr | **P2** — fee implausibly low |
| 9 | NYSTRS | Callan | general | cafr | OK |
| 10 | TRS Texas | Albourne | hedge_funds | cafr | OK (older FY) |

### P1.1 — LACERA Meketa fee likely aggregate "Consultants" line, not firm-specific

`plan_consultants.id = efbf4f07-d6b8-4424-b108-43ac1385d962`.
Stored `fee_usd = 4,547,000` for Meketa (general).
Excerpt: `Schedule of Investment Expenses … Other Investment
Expenses … Consultants 2,989 4,547 …`.

The excerpt shows `Consultants 2,989 4,547` — two columns,
prior-year and current-year totals for **all** consultants on the
expense schedule, not Meketa specifically. The fee field likely
captured the aggregate line, not the firm row. Re-validate
against the ACFR; if true, either move the fee off Meketa or
correct it to Meketa's specific line. **Severity: P1.**

**Resolution (2026-04-28)**: confirmed both LACERA Meketa rows
(FY24 `efbf4f07-…-43ac1385d962` and FY25
`3e681146-…-845132dbf627`) carried the same aggregate-line
excerpt across two FY columns ($2,989K + $4,547K, both in
thousands). `fee_usd` set to NULL on both rows; `notes` updated
to flag the aggregate origin and direct future readers to
re-extract for firm-level fees. The Meketa relationship itself
is correct — only the fee value was bad. **Status: RESOLVED.**
Follow-up to surface the missing co-consultants tracked as P2.6
below.

### P2.1 — CalSTRS RVK fee = $35K implausibly low for a $340B plan

`id = 7348516e-8324-4979-bdaf-126a451142e4`. `fee_usd = 35,000`
in FY2025. Excerpt:
`R.V. Kuhns & Associates, Inc. 9/1/22 35 (dollars in thousands)
Schedule VII…`. The "9/1/22" is the contract effective date and
"35" is in thousands, so $35K is what's stored — but $35K for a
general consultant on a $340B fund reads as either a partial-year
fee, a residual on a wound-down contract, or a parser
mis-interpretation. Re-validate against the schedule.
**Severity: P2.**

**Resolution (2026-04-28)**: full ACFR schedule scan via
`scripts/audit-acfr-firm-scan.ts` against the source PDF
(CalSTRS ACFR2024-25, 165 pages). RVK appears exactly once, on
page 88 Schedule of Advisors and Consultants:
`R.V. Kuhns & Associates, Inc. 9/1/22  35` under explicit
"(dollars in thousands)" disclosure. The $35K is the full
firm-level retainer disclosed; no additional RVK fees appear
elsewhere in the document. Same Schedule VIII shows other
CalSTRS consultants at much larger figures (Meketa $2,788K,
SitusAMC $10,310K) — RVK genuinely receives the smallest line
item. Stored value is correct; row annotated with the
schedule-scan finding. **Status: RESOLVED — editorial-low but
correct as captured.**

### P2.2 — NYSTRS Meketa fee = $123K low for a $140B plan

`id = 4cae92b3-5840-4003-a308-65bea98f6dd3`. Excerpt:
`General Expenses: Meketa Investment Group 123 (Schedule of
Investment Fees and Expenses — Year ended June 30, …)`.
Stored `fee_usd = 123,000`. Same shape as the CalSTRS RVK case —
"123" likely in thousands so $123K is captured, but plausibility
is borderline for general advisor on $140B AUM. Re-validate.
**Severity: P2.**

**Resolution (2026-04-28)**: full ACFR schedule scan via
`scripts/audit-acfr-firm-scan.ts` against the source PDF
(NYSTRS 2025-ACFR, 153 pages). Meketa appears twice: page 109
Schedule of Investment Fees and Expenses (the captured fee line
`Meketa Investment Group 123` under "dollars in thousands"), and
page 111 Investment Consultants directory (name + city only, no
additional fees). Stored fee_usd = $123,000 is the full
firm-level retainer disclosed for FY ended June 30, 2025. Row
annotated with the schedule-scan finding. **Status: RESOLVED —
editorial-low but correct as captured.**

### P2.3 — Wisconsin SWIB StepStone PE: ~~explicit $56K fee in excerpt not captured~~ (reframed)

~~`id = af4b8e4f-9231-4546-99d5-a78e58837b44`. `fee_usd = NULL`
and `fee_year = NULL`, but excerpt contains:
`SWIB spent 0.5 million during the fourth quarter of 2021 on
consultants, including 56,000 to StepSto[ne]…`. The $56,000 fee
is in the excerpt and was not lifted into `fee_usd`; should also
populate `fee_year = 2021`. **Severity: P2.**~~

**Reframe (Audit 1 Phase 3, 2026-04-28)**: the original framing
called for a `fee_usd = 56000, fee_year = 2021` backfill on the
PE row. Re-reading the verbatim excerpts on both SWIB StepStone
rows surfaced two reasons that backfill would be wrong:

1. **The $56,000 is a joint PE+RE disclosure**, not a PE-only
   fee. The exact phrase is: "56,000 to StepStone Group for
   private equity and real estate consultation". Putting $56K on
   the PE row alone would be wrong; putting it on **both** rows
   would replicate exactly the defect resolved in P1.3 (NYSCRF
   Aksia: single source figure duplicated across mandate rows,
   inflating attribution).
2. **The $56K is a Q4 2021 single-quarter spend, not an annual
   retainer.** The excerpt explicitly scopes it: "during the
   **fourth quarter** of 2021". Setting `fee_year = 2021` would
   render `$56K  FY21` in the UI, which a reader would naturally
   interpret as the FY2021 annual fee. Misleading.

**Resolution (2026-04-28)**: applied joint-mandate /
single-quarter annotation to both rows
(`af4b8e4f-…` PE and `f47c27ed-…` RE); `fee_usd` and `fee_year`
left NULL on both. Notes now record the joint-mandate /
single-quarter context and reference P1.3 as the same disclosure
shape (single source figure that cannot be allocated across
mandate rows without speculation). **Status: RESOLVED.**

### P2.4 — Wisconsin SWIB rows 3 + 7 share one generic excerpt across two mandates

`id = af4b8e4f-…` (StepStone PE) and `id = f47c27ed-…` (StepStone
real_estate) both cite the same `marketsgroup.org` paragraph
which doesn't differentiate mandate. Each mandate row should have
its own targeted source excerpt; current state collapses both
mandates onto one source paragraph. **Severity: P2.**

**Resolution (2026-04-28, Phase 4 source upgrade)**: replaced
the shared marketsgroup.org excerpt on both rows with
mandate-specific schedule lines from the SWIB Board of Trustees
Meeting of June 12, 2024 (page 132): the PE row now cites
`StepStone Group Private Equity Consulting Services 223,561`
and the RE row now cites `StepStone Group Real Estate Real
Estate Consulting Services 59,330`. Each row carries its own
targeted excerpt. **Status: RESOLVED.**

### P2.5 — Wisconsin SWIB source URL is third-party press, not plan disclosure

Both SWIB StepStone rows source from `marketsgroup.org`.
Verifiable but weaker provenance than a SWIB IPS or Board
meeting minute. Replace if a primary source surfaces.
**Severity: P2.**

**Resolution (2026-04-28, Phase 4 source upgrade)**: primary
SWIB source located. Both rows now cite the **SWIB Board of
Trustees Meeting of June 12, 2024** packet — strongest single
citation because page 10 carries an explicit narrative role
confirmation ("real estate strategy report and market outlook
presentation from staff and StepStone, SWIB's real estate
strategy consultant") and page 132 carries the firm-and-mandate
specific fee schedule lines. third-party press citation removed
from both rows. **Status: RESOLVED.**

**Phase 4 deep-scan (2026-04-28)** — supplementary findings on
top of the source upgrade. Schedule period basis confirmed as
**QUARTERLY** (definitive, from the `Total Quarterly Charges to
Funds` footer on every fee schedule across all 4 sampled SWIB
packets: Jun 12 2024, Sep 11 2024, Dec 11 2024, Mar 18 2026).

PE quarterly billing pattern: $223,561 → $220,763 → **$2,743**
→ $2,309 — a ~99% step-down between the Sep and Dec 2024
quarters. RE quarterly billing pattern is stable across all
observed quarters: $59,330 → $59,330 → $59,330 → $60,813.

Keyword scan across all 4 packets for `RFP|transition|wind
down|wound|terminat|new private equity consultant|PE
consultant` found **no termination, wind-down, or
RFP-replacement language for StepStone**. The only relevant
signal is the **PMFA RFP completion** noted on page 81 of the
Jun 12 2024 packet: "the Private Markets & Funds Alpha (PMFA)
division was nearing completion of the RFP process to select
investment due diligence, operational due diligence, and
database management services consultants for each of the PMFA
verticals." Best-fit explanation: the new vertical-specific
PMFA consultants narrowed StepStone's residual PE scope from
mid-2024 onward, while RE consulting (separate vertical)
continued unchanged. StepStone Group still appears in the Mar
18 2026 schedule.

Engagement classifications (recorded in row notes):
- PE row: **ACTIVE BUT DIMINISHED**
- RE row: **ACTIVE AND STABLE**

`fee_usd` and `engaged_through` left NULL on both rows.
`fee_usd` cannot be backfilled without a `fee_period`
disambiguator (see P2.7 below) — the UI's implicit
fee_usd-as-annual rendering would mislead readers if a
quarterly figure were stored. `engaged_through` left NULL
because both relationships remain active per the Mar 18 2026
schedule.

The PMFA RFP signal is itself worth surfacing as a future
research artifact: SWIB likely added a tier of vertical-
specific PE consultants in mid-2024 whose names are not yet
in `plan_consultants`. Logged for follow-up.

### P2.6 — Re-extract LACERA ACFR with firm-listing prompt to surface co-consultants

Spun off from the P1.1 resolution. The LACERA ACFR's "Consultants
2,989 4,547" aggregate line implies the plan has additional
general consultants beyond Meketa whose firm-level rows are not
yet in `plan_consultants`. Re-run extraction against the LACERA
ACFR with a stricter firm-listing prompt that targets the
underlying Schedule of Investment Expenses sub-rows rather than
the totals row, and insert any newly identified firms.
**Severity: P2.** Owner: next consultant-extraction iteration.

**Phase 5 quick scan (2026-04-28)**: downloaded the LACERA
ACFR-2025 (12.8 MB) and ran `audit-acfr-firm-scan.ts` over a
known-firm regex. Found page 15 carries an explicit **List of
Professional Consultants → Investment Consultants** subsection
naming **8 firms**:

| # | Firm | In `consultants` master list? | In `plan_consultants` for LACERA? |
|---|---|---|---|
| 1 | Albourne America, LLC | yes | — |
| 2 | Altus Group US, Inc. | no | — |
| 3 | Campbell Lutyens & Co., Inc. | no | — |
| 4 | Evercore Group, LLC | no | — |
| 5 | Jefferies, LLC | no | — |
| 6 | Kroll, LLC (US) | no | — |
| 7 | Meketa Investment Group | yes | yes (2 rows, fees NULLed) |
| 8 | Stepstone Group, LP | yes | — |

Net delta: **7 firms missing** from LACERA's `plan_consultants`
rows. Three of the eight (Albourne, Meketa, StepStone) are
already in our master `consultants` list; the other five would
need master-list inserts before plan_consultants inserts.

Page-25 narrative confirms Meketa as "LACERA's general
investment consultant"; the other firms occupy specialty roles
(Campbell Lutyens = placement / advisory, Evercore + Jefferies
= capital advisory, Kroll = valuation, Altus = real estate
valuation, StepStone = PE/RE consulting, Albourne = HF).

**Critical schema note for the next iteration**: LACERA's ACFR
does not disclose firm-level fees in the Schedule of Investment
Expenses — only the aggregate "Consultants" line. Re-extraction
will surface firm-level **relationships** but not firm-level
**fees**. New LACERA inserts will land with `fee_usd = NULL`
from this source — that is correct behavior, not a defect.

**UI mitigation applied (2026-04-28)**: a per-plan disclosure
note is now rendered beneath the LACERA Investment Consultants
section subtitle:
> "Coverage may be incomplete. The source ACFR's aggregate
> 'Consultants' line implies additional firms beyond those
> shown."

Implemented as a `Record<slug, string>` table
(`INCOMPLETE_CONSULTANT_COVERAGE_NOTES`) in
`app/(dashboard)/pensions/[slug]/page.tsx`, keyed by
`scrape_config.key`, passed into `ConsultantsSection` as a
prop. Generalizable: add another slug entry when another plan
needs the disclosure. Auto-hides when `rows.length === 0`
(empty-state branch already has its own card).

**Status: ESCALATED.** Audit-side gap concretely characterized
(7 missing firms, identified by name) and UI-mitigated. Full
re-extraction (master-list inserts for the 5 new firms +
plan_consultants inserts for all 7) deferred to the next
consultant-extraction iteration. **Owner**: next consultant-
extraction iteration. **Timeline**: within 1 week.

### P2.7 — Schema gap: no `fee_period` column to disambiguate quarterly vs annual fees

Surfaced by the SWIB Phase 4 deep-scan. The `plan_consultants`
schema currently exposes `fee_usd` (numeric) + `fee_year`
(integer) and the `/pensions/[slug]` UI implicitly treats every
stored fee as an **annual** figure (renders as `$X  FY{YY}`).

The SWIB Board fee schedules are published on a **quarterly,
accrual-basis** cadence (per the `Total Quarterly Charges to
Funds` footer). Storing $60,813 from the Mar 2026 SWIB packet on
the StepStone RE row would render as `$61K  FY26` and read like
an annual retainer when in fact it is a single-quarter accrual.
That forced both SWIB StepStone rows to keep `fee_usd = NULL` —
an honest but data-thin outcome.

A small schema migration would resolve this:

```sql
alter table public.plan_consultants
  add column if not exists fee_period text
  check (fee_period in ('annual', 'quarterly', 'ytd', 'monthly'));
```

…paired with UI logic that renders the period unit alongside the
figure (e.g., `$61K  /quarter  Q4 FY26` instead of `$61K  FY26`).

Defer the migration design and UI follow-through to **Audit 4
(Schema/DB)**; flagging here so it does not get lost. Affects
not just SWIB but any future plan whose primary disclosures are
sub-annual (board-meeting expense schedules are common — likely
many plans).

**Severity: P2.** **Status: OPEN.** Cross-references Audit 4.
**Owner**: Audit 4 schema review.

---

## Sub-audit 1.2 — CAFR-extraction source document integrity

| Check | Count |
|---|---|
| Orphaned rows (`source_document_id` with no matching `documents`) | **0** |
| CAFR rows pointing to documents missing `processed_at` | **0** |
| CAFR rows pointing to documents with NULL/empty `source_url` | **0** |
| CAFR rows with `source_document_id IS NULL` | **0** |

**All 53 cafr_extraction rows are anchored to a real, processed,
URL-bearing document.** No findings. **Clean.**

---

## Sub-audit 1.3 — Unused consultants in master list

Four firms in the 18-row `consultants` table have zero
`plan_consultants` references:

- Cliffwater (default specialties: general, private_equity,
  hedge_funds)
- Courtland Partners (real_estate)
- ORG Portfolio Management (real_estate)
- Pension Consulting Alliance (real_estate, real_assets)

All four are real, active firms; they simply do not advise any of
the 20 plans currently in coverage. Three of four are
real-estate-leaning specialists, mirroring our limited coverage
of dedicated RE consultants. Healthy state for a master-list
pattern: keeping the firms pre-canonicalised lets future plan
additions match without re-inserting. **Severity: P3.**

---

## Sub-audit 1.4 — Conflicts, duplicates, outliers

### No plans with > 10 rows
All 20 plans within the expected 1–10 row range. **OK.**

### Multi-year duplicates (intentional)

Six plan + firm + mandate triples appear in both FY2024 and
FY2025:

| Plan | Firm | Mandate | Years |
|---|---|---|---|
| LACERA | Meketa Investment Group | general | 2024, 2025 |
| TRS Illinois | Meketa Investment Group | general | 2024, 2025 |
| TRS Illinois | StepStone Group | private_equity | 2024, 2025 |
| TRS Illinois | RVK | general | 2024, 2025 |
| TRS Illinois | Aksia | private_equity | 2024, 2025 |
| TRS Illinois | StepStone Group | real_estate | 2024, 2025 |

Per Phase A spec ("show all rows — don't deduplicate. Users get
to see the trajectory."), these are intentional. UI groups by
mandate then sorts by `fee_year DESC`, so each pair renders as
two rows under the same mandate header showing the year-over-year
fee delta. **Severity: P3 — confirms intended behavior.**

### No outlier fees > $5M
**OK.** Highest stored fee is `4,547,000` (LACERA Meketa, also
flagged as P1.1). No suspiciously large rows.

---

## Sub-audit 1.5 — Stale data flags

### Manual-research rows with `fee_year` > 3 years old
**0 rows.** All manual entries are recent or have NULL fee_year.
**OK.**

### CAFR-extracted plans with latest source doc > 2 years old

| Plan | Rows | Latest source doc |
|---|---|---|
| Teacher Retirement System of Texas | 2 | 2023-08-31 |

### P1.2 — TRS Texas consultant data is 2+ years old

The two TRS Texas rows (Albourne hedge_funds, plus one other)
reference an ACFR dated 2023-08-31. The plan very likely has
since published FY2024 and FY2025 ACFRs that aren't yet ingested.
The displayed "FY23" fees will read as stale on the UI alongside
peer plans showing FY25 data.

**Action**: re-ingest TRS Texas latest ACFR; the classify cron
will refresh the consultant rows. **Severity: P1.**

**Resolution (2026-04-28)**: confirmed the staleness is plan-
level (both rows share `meeting_date = 2023-08-31`). Per-row
excerpts ARE firm-specific in this case (unlike LACERA), so the
captured fees are correct as recorded — the issue is solely
vintage. Both rows
(`cb3a7518-…-4cd11e335b89` Albourne and `e2e8ff68-…-c2455a2d764c`
Aon) annotated with a `notes` field flagging the FY23 source and
noting the values will refresh when a newer TRS Texas ACFR is
ingested. **Status: RESOLVED** (mitigation, not refresh — actual
re-ingest still pending the classify cron picking up a newer
TRS Texas ACFR).

---

## Sub-audit 1.6 — Pattern check for systemic extraction bugs

Run after the LACERA aggregate-line bug surfaced, to detect any
other rows with the same defect family before it reaches a demo.
Three patterns swept across all 53 cafr_extraction rows.

### Pattern 1 — `Consultants` near a number in `source_excerpt`

**Hits**: 2 rows. Both are the LACERA Meketa rows already
addressed under P1.1 (now `fee_usd = NULL`). No previously
unflagged occurrences. **No new finding.**

### Pattern 2 — Same `source_excerpt` shared by multiple rows

**Hits**: 7 excerpt groups. Per-group classification:

| Plan | Rows | Excerpt shape | Verdict |
|---|---|---|---|
| TRS Illinois ("Investment consultants" schedule) | 8 | List of 4 firms × 2 FY columns; each row anchored to its firm-specific line | OK |
| TRS Illinois ("Investment advisors" schedule) | 2 | List with Meketa specific line; rows take FY24/FY25 columns | OK |
| CalPERS | 2 | List: Meketa $2,445K / Wilshire $2,950K / Total $5,395K — neither row took the total | OK |
| TRS Texas | 2 | List: Albourne / JLL / AON Hewitt — each row took its firm line | OK (P1.2 staleness annotation already in place) |
| LACERA | 2 | Aggregate `Consultants` totals row, no firm-level lines | RESOLVED (P1.1 — NULLed) |
| MN SBI | 2 | Narrative paragraph naming Aon + Meketa as general consultants; no fee values inside | OK (`fee_usd` is NULL on both rows — relationship-only excerpt) |
| **NYSCRF Aksia** | **2** | **Single firm line `Aksia, LLC $ 800,000` shared by HF + PE rows, both storing $800K → $1.6M attributed against $800K source** | **DEFECTIVE** |

### P1.3 — NYSCRF Aksia: single source fee duplicated across two mandate rows

Both NYSCRF Aksia rows (`13445a1b-6355-4429-98a0-8c053cad958f`
hedge_funds and `9ca01de1-7fe0-4cf4-b863-59bd6abfbab8`
private_equity) share an identical 90-character excerpt with
exactly one Aksia line:

```
CONSULTANT AND ADVISOR FEES
For the Fiscal Year Ended March 31, 2025.
Aksia, LLC $ 800,000
```

Stored `fee_usd = 800,000` on **both** rows, so attribution sums
to $1.6M against a single $800K source figure. The relationship
itself is plausible (Aksia genuinely advises NYSCRF on both HF
and PE), but the $800K cannot be resolved across the two
mandates from this excerpt alone — and the captured excerpt
contains no second Aksia line. Same defect family as P1.1
(unresolvable fee aggregation), different mechanism (mandate-
split rather than firm-split).

**Severity: P1.**

**Resolution (2026-04-28)**: applied — `fee_usd` set to NULL on
both `13445a1b-…` (HF) and `9ca01de1-…` (PE). `notes` now reads:
"Source excerpt contains a single Aksia, LLC $800,000 line for
FY2025 that does not disambiguate hedge_funds vs private_equity
work. The relationship is valid for both mandates but the $800K
cannot be split across them from the captured excerpt; fee
NULLed pending firm-level disambiguation against the original
schedule." Both relationships preserved. **Status: RESOLVED.**

### Pattern 3 — Round-thousand fees (informational)

**Hits**: 29 rows. All from CAFR Schedules of Investment
Expenses, which are conventionally published in $K rounded to
whole thousands — so this pattern is the expected baseline, not a
defect signal on its own. The "low for AUM" cases already in
P2.1 (CalSTRS RVK $35K) and P2.2 (NYSTRS Meketa $123K) appear
here, alongside benign large-plan retainers ($2.95M Wilshire at
CalPERS, $2.83M Cambridge at CalSTRS). No new finding from this
pattern in isolation. **No new finding.**

---

## Recommended next steps

1. ~~**P1.1 fix**~~ — RESOLVED 2026-04-28 (both LACERA Meketa
   rows NULLed + annotated).
2. ~~**P1.2 fix**~~ — RESOLVED 2026-04-28 (both TRS Texas rows
   annotated with FY23 staleness note; actual refresh awaits a
   newer ACFR ingest).
3. ~~**P1.3 fix**~~ — RESOLVED 2026-04-28 (both NYSCRF Aksia
   rows NULLed + annotated with single-source / two-mandates
   rationale).
4. ~~**P2.1, P2.2**~~ — RESOLVED 2026-04-28 via full ACFR
   schedule scan (`scripts/audit-acfr-firm-scan.ts`). Both fees
   confirmed as the full firm-level retainer in their source
   ACFR; rows annotated with schedule-scan provenance.
5. ~~**P2.3** — backfill `fee_usd = 56000`, `fee_year = 2021` on
   SWIB StepStone PE row.~~ — RESOLVED 2026-04-28 by reframe
   (joint-mandate / single-quarter annotation; no fee backfill).
6. ~~**P2.4, P2.5**~~ — RESOLVED 2026-04-28 via Phase 4 source
   upgrade (SWIB Board of June 12 2024 packet replaces
   marketsgroup.org; mandate-specific schedule lines replace
   shared excerpt). Phase 4 deep-scan also confirmed quarterly
   period basis, ACTIVE-BUT-DIMINISHED PE engagement, and a
   PMFA-RFP signal for future research.
7. **P2.6** — ESCALATED 2026-04-28. Phase 5 quick scan
   identified **7 missing firms** by name (Altus Group,
   Campbell Lutyens, Evercore, Jefferies, Kroll, Albourne,
   StepStone) on LACERA's page-15 Investment Consultants list.
   UI mitigation applied (per-plan disclosure note on
   `/pensions/lacera`). Full re-extraction deferred to the
   next consultant-extraction iteration; timeline within 1
   week. Source URL:
   `https://www.lacera.gov/sites/default/files/assets/documents/annual_reports/ACFR-2025.pdf`.
8. **P2.7** — schema gap surfaced by SWIB Phase 4 deep-scan: no
   `fee_period` column to distinguish quarterly vs annual fees.
   **→ Cross-reference: Audit 4 (Schema/DB)** will conduct the
   migration design and own the resolution. Listing here so
   Audit 4 has a concrete first item to address.
9. **P3.1** (4 unused master-list consultants — Cliffwater,
   Courtland Partners, ORG Portfolio Management, Pension
   Consulting Alliance) — no data action. **→ Possible
   cross-reference: Audit 2 (Code Quality)** could examine
   whether the master-list / used-firms split is intentional
   architecture (canonicalization staging) or accidental
   over-seeding; if accidental, dead-row cleanup is a
   code-quality concern. Logged here for Audit 2's intake.
10. **P3.2** (intentional multi-year duplicates) — no action;
    confirms Phase A spec behavior.
