# Allocus - Build Spec v3

**Product:** Predictive LP intelligence platform for private markets fundraising teams
**Geography:** US + Canada public pensions (~350 plans available, 50 plan target by Month 3, 20 today)
**Buyers:** PE/infra/credit IR and fundraising teams at $500M-$10B AUM firms
**Owner:** Vitek Vrana / Bloor Capital
**Spec version:** v3.0 (2026-04-30, end of Week 1 of Month 1)
**Supersedes:** lp_signal_build_spec_v2_2026-04-29.md

---

## 0. What changed from v2

v2 was written 2026-04-29 at the start of Week 1 of Month 1. v3 reflects what Week 1 actually shipped and what Week 1 disproved.

1. **Press release stream framing was wrong.** v2 described press releases as the highest-density commitment stream. Week 1 shipped 3 of 5 press release scrapers (CalPERS, CalSTRS, Oregon) and ingested 63 releases. T1 commitment-signal yield was 0% across all 3 plans. Press releases at large public pensions serve PR/governance/performance functions; deal-level disclosure is reserved for board minutes and Investment Transactions Reports. The actual value of press releases is cross-source verification context, relationship-graph signal, and Type 4 (named-fund-without-amount) relationship intelligence.
2. **IPS is the actual high-yield predictive stream.** Week 1 IPS ingestion produced 25 target allocation rows across 3 plans (CalPERS 11, CalSTRS 8, Oregon 6). The IPS captures sub-sleeve granularity (CalPERS Fixed Income split into 5 sub-sleeves) that CAFR rolls up. IPS allocations feed directly into the predictive layer (Section 5).
3. **Cross-source verification semantics need a framework, not just a function.** v2 specified a single `verifyCrossSource(signalA, signalB)` function. Day 5 shipped it; Day 6 redesigned it after Day 5 produced 9 of 48 conflicts (most of which were time-period artifacts, not data quality issues). The fix is two-part: a temporal pre-filter and a `policy_changed` verdict. Each pairing of record types (X, Y) needs its own eligibility filter, temporal alignment rule, and verdict vocabulary defined BEFORE the prompt. Documented at `docs/architecture/cross-source-verification-semantics.md`.
4. **Pacing data is already captured by the existing classifier.** v2 listed pacing plans as a separate Week 3 stream. Week 1 investigation showed pacing is embedded in board minutes / Investment Committee packets at all 5 plans, and 9 T3 pacing signals (signal_type=3, non-seed) have already been extracted by the existing classifier across CalPERS / CalSTRS / SMRS / OPERF. Pacing does not need a separate scraper class.
5. **Type 4 Relationship Signal added to backlog.** Press release inspection surfaced "named funds without per-fund amounts" content that doesn't fit T1/T2/T3. Defer to Month 2 relationship-graph work.
6. **Classifier per-signal validation refactor added to backlog.** 13 board-minute documents currently sit in `processing_status='error'` because one bad signal in a doc fails the whole doc's Zod validation. Should be per-signal validation with bad signals dropped and good signals retained. P2 architectural quality issue.

v3 reflects what was actually built (Days 1-7 of Week 1, Month 1). The original v1 sits at `lp_signal_build_spec_v1_2026-04-21.md` and v2 at `lp_signal_build_spec_v2_2026-04-29.md` for historical reference.

---

## 1. Product thesis in one sentence

IR teams at mid-market PE/infra/credit GPs waste 10+ hours per week on manual pension research using stale data and disconnected tools. Allocus monitors 7-10 document streams per pension plan continuously, predicts which plans will allocate to a given asset class within a forward window, and surfaces the right contact at each plan, in one workflow.

---

## 2. The mission stated precisely

An IR person opens Allocus and sees three things, in this order:

1. **Which pension plans will allocate to my niche soon** - predictive signal generated from continuous monitoring of multiple document streams per plan
2. **How much they will allocate** - dollarized allocation gap (target % × NAV minus current commitments), filtered to user's strategy
3. **Who to contact at each plan** - relationship graph showing the right consultant, board chair, asset class head, or staff lead per opportunity

---

## 3. The 7-stream document model

The institutional 360 degree view requires monitoring multiple document types per plan, with cross-source verification. Each stream produces signal independently; cross-source confirmation increases confidence weight.

| Stream | What it produces | T1 yield (Week 1 evidence) | Update frequency | Today (20 plans) |
|---|---|---|---|---|
| 1. Board minutes | Commitments, votes, allocation discussions, **pacing** | High (393 T1 + 9 T3 signals to date) | Monthly/quarterly | 12/20 plans |
| 2. CAFR/annual report | Allocations, fees, performance, consultants | Medium (allocations primary, occasional T1) | Annually | 19/20 plans |
| 3. Investment Policy Statement (IPS) | Target allocations (sub-sleeve granularity), pacing parameters, manager criteria | High for predictive layer (25 target rows on 3 plans, splits CAFR rollups) | When changed | 4/20 plans (Week 1: CalPERS, CalSTRS, NYSCRF, Oregon) |
| 4. Quarterly performance reports | Manager-level detail, mid-cycle commitments | Untested | Quarterly | 0/20 plans |
| 5. Asset class committee minutes | PE/RE/Infra-specific deal flow | Untested but likely high | Monthly | 1/20 (LACERA) |
| 6. Pacing plan | Annual deployment plans by asset class | Subsumed by board minutes (already extracted) | Annually | n/a (no separate stream needed) |
| 7. Press releases | Cross-source verification context, governance signal, Type 4 relationship signal | **0% T1 across CalPERS / CalSTRS / Oregon (Week 1)** | Daily | 3/20 plans |

**Stream value framing (revised after Week 1):**

- Board minutes are the highest-yield direct-signal stream. Most T1 commitment signals and all T3 pacing signals come from here.
- IPS is the highest-yield stream for the predictive layer. Sub-sleeve granularity feeds niche matching and allocation-gap calculation.
- Press releases at large public pensions (CalPERS, CalSTRS, Oregon, NYSCRF) yield ~0% T1 commitments. Their value is (a) cross-source verification context for board-minute commitments, (b) governance/staff signal feeding the relationship graph (Section 6), and (c) Type 4 "named funds without amounts" relationship intelligence. Smaller plans may publish more deal-level releases; sample of 3 large plans is not yet representative of all 20.
- Pacing-as-a-separate-stream was a v2 mistake. Pacing is embedded in Investment Committee packets and the existing classifier extracts it. Stream 6 is retired.

**Plus secondary sources** (P&I, IPE, FundFire, Markets Group): third-party confirmation, commitments often surface here days before official documents. Currently 0% scraped; will be added in Month 2+.

**Cross-source verification logic:**
- Single-source signal: confidence weight 1.0
- Two-source confirmation (e.g., press release + board minutes): weight 1.5
- Three+ sources (press + minutes + CAFR): weight 2.0
- Sources conflict: signal flagged, not auto-resolved
- See Section 5e and `docs/architecture/cross-source-verification-semantics.md` for the per-pairing semantics framework.

---

## 4. Signal definitions (the classifier's job)

The classifier processes documents from any of the 7 streams and produces structured signals across three types. False positives destroy customer trust - when in doubt, classify as noise.

### Signal Type 1 - Commitment Announcement (HIGHEST PRIORITY)

A specific dollar commitment to a specific fund or manager that has been APPROVED.

**Source streams:** Board minutes, press releases, committee minutes
**Cross-source verification:** Same commitment confirmed by 2+ streams = high-confidence signal

**Required indicators (at least 2):**
- Specific dollar amount
- Specific GP name
- Specific fund name or asset class
- Approval language

**Fields extracted:**
- Plan name, GP name, fund name, commitment amount, asset class, approval date, source stream(s), source documents (with page refs)

### Signal Type 2 - Target Allocation Change (MEDIUM PRIORITY)

A formal vote to change target allocation percentages.

**Source streams:** Board minutes, IPS, CAFR (YoY comparison)
**Cross-source verification:** New IPS publication + board minutes vote = strongest signal

**Fields extracted:**
- Plan name, asset class affected, old target %, new target %, implementation timeline, implied dollar delta (NAV × delta %), source stream(s)

### Signal Type 3 - Pacing Plan Change (LOWER PRIORITY)

A meaningful change to annual deployment pacing.

**Source streams:** Pacing plan documents, board minutes referencing pacing review
**Cross-source verification:** Pacing plan publication + board minutes acknowledgment = strongest

**Fields extracted:**
- Plan name, asset class(es), prior year pacing, new year pacing, percentage change, source stream(s)

### Priority scoring

Each signal scored 0-100, surfaced in dashboard ranked by score:

```
priority_score =
  base_type_score (40 if Type 1 else 25 if Type 2 else 10 if Type 3)
  + size_multiplier (0-30 based on dollar magnitude)
  + recency_multiplier (0-15 based on days since signal date)
  + plan_tier_multiplier (0-15 based on plan AUM)
```

This is prompt-driven, not a trained model at v1. The classifier outputs `priority_score` directly. Move to trained model when feedback loop produces enough labeled data (Month 6+).

**Cross-source verification weight is applied as a multiplier per Section 3, computed and stored separately from `priority_score` in `signals.confidence_multiplier`.** Display logic computes the effective rank as `priority_score * confidence_multiplier`. The two columns stay separate so that the classifier-emitted base score and the verification-derived bonus are independently observable. Multiplier values: 1.0 single-source / 1.5 two-source / 2.0 three+ source, where each "source" is a distinct confirming verification (`confirms` / `partially_confirms` / `policy_changed`). `conflicts` and `unrelated` verdicts do not contribute. (Spec resolution 2026-04-30: v2 had a contradictory `verification_multiplier (0-10)` additive component in this formula. Resolved in v3 to keep verification weighting strictly multiplicative per Section 3.)

---

## 5. The predictive layer (Month 2 deliverable)

The predictive layer transforms continuous signal into forward-looking allocation predictions. Built on top of the 7-stream foundation; cannot be built before stream depth exists.

### Five components

**5a. Allocation gap calculator**
For each plan × asset class, compute: target_pct × NAV - current_commitments_dollar. Surface the dollar gap remaining. Rank plans by largest gap in user's target asset class.

**5b. Pacing trajectory model**
Given last 4 quarters of pacing data, project next 4 quarters. Identify plans with accelerating pacing in user's asset class.

**5c. Commitment cycle detection**
Per plan, measure historical lag from RFP issuance to commitment, and from manager presentation to commitment. Plans currently in the "lag window" since last RFP are likelier to commit soon.

**5d. Niche matching**
User submits fund profile (asset class, ticket size range, geography, strategy). System matches against:
- Plan's documented investment strategy (from IPS)
- Plan's historical commitments to similar GPs (from CAFR + board minutes)
- Plan's allocation gap in matching asset class
Returns ranked list of best-fit plans.

**5e. Cross-source verification weighting**

Apply weighting from Section 3 cross-source rules to all predictions. Surface confidence interval per prediction.

The verifier is implemented at `lib/predictive/verify-cross-source.ts`. v1.1-allocation handles allocation-allocation pairings (CAFR vs IPS). It uses a two-step design:

1. `buildVerifiablePairs()` pre-filters pairs by temporal alignment (CAFR fiscal year end must fall within an IPS adoption window) and structural sub_class compatibility. Pairs that fail either filter are dropped without invoking the model.
2. `verifyCrossSource(recordA, recordB)` calls the model on retained pairs and returns one of `confirms` / `partially_confirms` / `policy_changed` / `conflicts` / `unrelated`. The `policy_changed` verdict distinguishes legitimate mid-window policy revisions from genuine data quality issues.

Future pairings (signal-signal for commitment cross-source, consultant-consultant for de-dup, allocation-pacing for consistency) will require pairing-specific eligibility filters, temporal alignment rules, and verdict vocabularies. Each pairing's semantics must be specified before the prompt is written. Framework documented at `docs/architecture/cross-source-verification-semantics.md`.

### Output format

A page that says: "If you raise an [asset class] fund right now, here are the [N] plans most likely to commit to your fund in the next 6 months, with predicted dollar amounts and the right contact at each plan."

### Validation approach

- Manual labeling of 20-30 historical commitments per plan (for top 5 plans only initially)
- Backtest predictions against known outcomes
- Track accuracy per plan, per asset class, per signal type
- Surface accuracy metrics to users (transparency over false confidence)

---

## 6. The relationship graph (Month 2 deliverable)

For "who to contact" to be real, we need stakeholder data per plan. Three layers:

| Layer | Source | Difficulty |
|---|---|---|
| Internal staff (CIO, asset class heads, deputy CIOs) | Plan website "About Us" / "Investment Staff" | Easy - usually public |
| Board members (chairs, committee chairs) | Annual report, board minutes attendance lists | Easy-medium |
| External consultants and contacts | Already in plan_consultants table | Done |
| Recently-met GP partners | Board minutes "presentations made by" sections | Hard - text extraction |

Schema additions needed:
- plan_stakeholders table: plan_id, name, title, asset_class_responsibility, source_url, source_excerpt, last_verified_at
- Link stakeholders to specific signals (when a CIO presents a recommendation that gets approved, that's a relationship signal)

Output: per-signal contact recommendation. "CalSTRS approved $250M to KKR Infra V on March 4. Right contact for follow-up: Christopher Ailman (CIO) or [name] (Head of Private Investments). Consultant on this search was Meketa - relevant contact: [name]."

---

## 7. Architecture
┌─────────────────────────────────────────────────────────────┐
│         Continuous scraping (Vercel Cron + GitHub Actions)  │
│  Per-plan schedules, fan-out for low-volume sources         │
└─────────────────────────────────────────────────────────────┘
│
▼
┌─────────────────────┐      ┌──────────────────────┐
│  Multi-stream       │─────▶│  Document Store      │
│  Scrapers (7 types) │      │  (Supabase Storage)  │
└─────────────────────┘      └──────────────────────┘
│                            │
│                            ▼
│                  ┌──────────────────────┐
│                  │  Document Hash Check │
│                  │  (skip if unchanged) │
│                  └──────────────────────┘
│                            │
▼                            ▼
┌─────────────────────────────────────────────────────┐
│         Claude API - Multi-classifier               │
│  - Consultant extraction (existing)                 │
│  - Signal extraction (existing, expanding)          │
│  - Stakeholder extraction (new)                     │
│  - Cross-source verification                        │
│  Output: structured JSON per stream                 │
└─────────────────────────────────────────────────────┘
│
▼
┌─────────────────────────────────────────────────────┐
│         Supabase Postgres                           │
│  Tables:                                            │
│  - plans, documents, signals (existing)             │
│  - pension_allocations, plan_consultants (existing) │
│  - allocation_policy_changes (existing)             │
│  - plan_stakeholders (new, Month 2)                 │
│  - predictive_scores (new, Month 2)                 │
│  - source_verifications (new, Month 1)              │
└─────────────────────────────────────────────────────┘
│
▼
┌─────────────────────────────────────────────────────┐
│         Predictive Engine (Month 2 deliverable)     │
│  - Allocation gap calculator                        │
│  - Pacing trajectory model                          │
│  - Commitment cycle detection                       │
│  - Niche matching                                   │
│  - Cross-source verification weighting              │
└─────────────────────────────────────────────────────┘
│
▼
┌─────────────────────────────────────────────────────┐
│         Next.js 14 Dashboard (Vercel)               │
│  - Per-plan profile (existing)                      │
│  - Cross-plan signal feed (existing)                │
│  - Predictive ranking page (Month 2)                │
│  - Stakeholder relationship view (Month 2)          │
│  - User fund-profile + niche match (Month 2)        │
└─────────────────────────────────────────────────────┘

---

## 8. Tech stack

Same as v1, with additions:

| Layer | Choice | Status |
|---|---|---|
| Frontend | Next.js 14 (App Router) + Tailwind | Existing |
| Hosting | Vercel | Existing - upgrading to Pro by Day 4 of Week 1 |
| Database | Supabase Postgres | Existing |
| Storage | Supabase Storage | Existing |
| Scraping | Node.js + Cheerio + Playwright | Existing |
| Document parsing | Claude API (Sonnet) with vision | Existing |
| Migration tracking | Supabase CLI | Adopted Day 18 |
| Scheduling | Vercel Cron + GitHub Actions overflow | Mostly Vercel today, GitHub Actions added when Vercel Pro insufficient |
| Email alerts (v2) | Resend | Not yet integrated |
| Predictive compute | Anthropic API + Postgres views | New, Month 2 |

### Estimated monthly cost at Month 4 (50 plans, 7 streams, predictive layer)

- Vercel Pro: $20
- Supabase Pro: $25
- Anthropic API (production scrape + classify + predict): $400-700
- GitHub Actions overflow scheduler: $0-50
- Domain + misc: $15
- **Total: ~$500-800/month**

Revenue at $15k ARR × 5 paying customers = $6.25k MRR. Gross margin ~80% at this scale; improves as plan count grows without proportional API increase.

---

## 9. Data source strategy

### US public pensions (~300 plans available)

**Tier A (deep, continuous, today): 5 plans**
CalPERS, Oregon PERS, Virginia RS, NJ DOI, Minnesota SBI. 31-173 docs each. Full board minutes flow. CAFR. Adding all 7 streams in Month 1.

**Tier B (continuous, low volume, today): 10 plans**
CalSTRS, LACERA, Mass PRIM, NYSCRF, Michigan SMRS, PA PSERS, WSIB, NYSTRS, TRS Illinois. 1-37 docs each. Cron jobs run but capture less - either plans publish less, or scrapers miss material. Need investigation in Month 1.

**Tier C (manual-only, today): 5 plans**
Florida SBA (Akamai), TRS Texas (Akamai), Colorado PERA (no minutes), Wisconsin SWIB (target-only by design), NC Retirement (no public index), Ohio PERS (no public index). Strategy: skip for now, revisit if blockers can be unblocked or sources change.

**Tier 1 expansion (Month 3 target): +30 plans**
Maryland SRPS, Connecticut Retirement, Illinois SURS, Arizona SRS, PA SERS, Ohio STRS, NYC Retirement (NYCERS, NYC TRS, Police Pension), and 20 others via BoardDocs/Granicus generic scrapers.

**Tier 2 (later, eventually): smaller state and municipal plans**
Many use BoardDocs, Granicus, CivicClerk. Generic scraper unlocks 100+. Build in Month 6+.

### Canadian public pensions (~50 plans)

Different strategy required. Canadian plans don't publish board minutes the same way. Build in Month 4+:

| Plan | Source | Method |
|---|---|---|
| CPP Investments | Quarterly results + press releases | Press release scraper |
| OTPP | Annual report + press releases | Press release scraper |
| CDPQ | Press releases + annual report (FR + EN) | Press release scraper |
| OMERS | Press releases + annual report | Press release scraper |
| BCI | Press releases | Press release scraper |
| AIMCo | Press releases | Press release scraper |
| HOOPP | Annual report only | Manual quarterly check |
| PSP Investments | Annual report only | Manual quarterly check |

For Canadian plans: signal types shift to press-release-detected commitments, year-over-year allocation comparisons from annual reports.

### Per-plan config schema (existing)

```sql
-- Already exists, extending with stream tracking
CREATE TABLE plans (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  country text CHECK (country IN ('US', 'CA')),
  aum_usd bigint,
  tier_designation text CHECK (tier_designation IN ('A', 'B', 'C')),  -- replaces old 1/2/3
  scrape_method text,  -- existing field
  scrape_url text,
  scrape_config jsonb,
  last_scraped_at timestamptz,
  active bool DEFAULT true,
  -- New columns for stream tracking (Month 1):
  streams_active text[],  -- e.g., ['board_minutes', 'cafr', 'press_release']
  stream_health jsonb,  -- per-stream last scraped, last success, error count
  created_at timestamptz DEFAULT now()
);
```

---

## 10. Database schema

Existing tables (preserved):
- plans, documents, signals (from v1, populated)
- pension_allocations (current and target allocations per plan × asset class)
- allocation_policy_changes (votes detected)
- plan_consultants (75 rows, full provenance, fee_period support)
- plan_consultant_history (versioning)
- consultants (canonical list)
- mandate_types, asset_classes (enums)
- user_profiles, firms, allowed_emails (auth)

New tables (Month 1-2):

```sql
-- Stakeholder data (Month 2)
CREATE TABLE plan_stakeholders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid REFERENCES plans(id),
  name text NOT NULL,
  title text NOT NULL,
  asset_class_responsibility text[],  -- which asset classes they cover
  stakeholder_type text CHECK (stakeholder_type IN ('staff', 'board', 'committee_chair', 'consultant_contact', 'recent_gp')),
  email text,  -- if publicly disclosed
  phone text,
  source_url text NOT NULL,
  source_excerpt text,
  last_verified_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- Predictive engine output (Month 2)
CREATE TABLE predictive_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid REFERENCES plans(id),
  asset_class text NOT NULL,
  forecast_window_months int CHECK (forecast_window_months IN (3, 6, 12)),
  predicted_commitment_usd bigint,
  confidence decimal(3,2),
  inputs jsonb,  -- which signals + streams contributed
  computed_at timestamptz DEFAULT now()
);

-- Cross-source verification tracking (Week 1, Day 5 + Day 6 of Month 1).
-- Generic record-pair design: any two records of types {signal, allocation,
-- consultant} can be verified. v1.1-allocation currently uses
-- (allocation, allocation) pairs.
CREATE TABLE source_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_a_type text NOT NULL CHECK (record_a_type IN ('signal', 'allocation', 'consultant')),
  record_a_id uuid NOT NULL,
  record_b_type text NOT NULL CHECK (record_b_type IN ('signal', 'allocation', 'consultant')),
  record_b_id uuid NOT NULL,
  verification_type text NOT NULL CHECK (verification_type IN ('confirms', 'partially_confirms', 'policy_changed', 'conflicts', 'unrelated')),
  confidence decimal(3,2) CHECK (confidence >= 0 AND confidence <= 1),
  rationale text,
  verifier_version text NOT NULL,  -- e.g., 'v1.1-allocation'
  created_at timestamptz DEFAULT now()
);
-- Unique pair index uses least()/greatest() so (A,B) and (B,A) collide.
-- Re-running on the same pair updates rather than duplicating.
```

### prompt_version conventions

Both `signals.prompt_version`, `pension_allocations.prompt_version`, and `source_verifications.verifier_version` use the same naming scheme: `v{major}.{minor}-{stream-or-target}`.

Current values in production:

| Column | Value | Meaning |
|---|---|---|
| `signals.prompt_version` | `v2.x-board-minutes`, `v1.0-pr` | Board-minute classifier (existing) and press-release classifier (Day 2) |
| `pension_allocations.prompt_version` | `v1.0-cafr`, `v1.1-cafr`, `v1.2-cafr`, `v1.3-cafr` | CAFR allocation extractor across plan-specific calibrations |
| `pension_allocations.prompt_version` | `v1.0-ips` | IPS allocation extractor (Day 3) |
| `source_verifications.verifier_version` | `v1.1-allocation` | Cross-source verifier for allocation pairs (Day 6) |

When introducing a new prompt or a calibration revision, bump the `{minor}` and write the new value. Past data is NOT retroactively re-tagged; the verifier_version on a row records which prompt produced that row. Migrations or re-runs explicitly clear old rows before persisting new ones (see `lib/predictive/verify-cross-source.ts` for the v1.0 → v1.1 migration pattern).

```sql

-- User fund profile for niche matching (Month 2)
CREATE TABLE user_fund_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id),
  asset_class text NOT NULL,
  ticket_size_min_usd bigint,
  ticket_size_max_usd bigint,
  geography text[],
  strategy_keywords text[],
  active bool DEFAULT true,
  created_at timestamptz DEFAULT now()
);
```

---

## 11. Build phases - 4 month roadmap

### Month 1 (May 2026): Stream depth on existing 20 plans

**Week 1 (DONE, 2026-04-23 to 2026-04-30, 13 commits):**

Shipped:
- 3 of 5 press release scrapers: CalPERS, CalSTRS, Oregon. 63 releases ingested. T1 yield 0% across all 3 (key Week 1 finding).
- 4 of 5 IPS scrapers: CalPERS, NYSCRF, Oregon, CalSTRS. 25 IPS allocation rows extracted across CalPERS / CalSTRS / Oregon (NYSCRF IPS ingested but extracted 0 rows; needs Week 2 investigation).
- Cross-source verification primitive v1.1 with temporal pre-filter and `policy_changed` verdict. 29 allocation pairs verified across CalPERS / CalSTRS / Oregon. 2 conflicts surfaced (1 real: CalPERS Credit extraction issue; 1 false positive: CalPERS Public Equity / Cap Weighted sub-sleeve misread).
- Schema: `source_verifications` table + unique-pair index + `policy_changed` verdict.
- Architecture: `docs/architecture/cross-source-verification-semantics.md` framework for future pairings.
- 7 daily findings docs.

Deferred:
- Mass PRIM press release scraper: aggregator feed, 2-3 PRIM-authored PDFs over 5 years, not worth the build cost.
- Mass PRIM IPS scraper: no discoverable index URL for the rotating-path PDF.
- NYSCRF press release scraper: AJAX endpoint requires reverse-engineering, deferred to Week 2.
- Pipeline integration of `verifyCrossSource` into live ingestion: deferred to Week 2 Day 1.

**Week 2 (UPCOMING, 2026-05-01 to 2026-05-07):**

Priorities, in order:
1. Pipeline integration of `verifyCrossSource` (Day 1) - auto-run on new allocation arrival, write `source_verifications` rows during ingestion, update signal confidence.
2. CAFR extraction quality fixes for CalPERS Credit and CalPERS Public Equity sub-sleeve issues (Day 2) - the 2 real or near-real conflicts surfaced by v1.1 verifier.
3. Mass PRIM IPS scraper via hardcoded URL pattern (Day 3 first half).
4. NYSCRF press release AJAX investigation (Day 3-4).
5. Relationship graph foundation - `plan_stakeholders` schema + first staff directory scraper (Day 5+).
6. Audit follow-ups from Week 1 P2 findings interspersed.

**Week 3:** Asset class committee minutes for top 10 plans (LACERA already done). Pacing as a separate stream is retired - subsumed by board minutes.

**Week 4:** Quarterly performance reports for top 10 plans + Month 1 audit pass.

End of Month 1: 20 plans × 4-5 active streams given source availability. The original "7 streams" target is reduced to 5-6 because (a) press releases yield ~0% T1 and serve a different purpose, (b) pacing is subsumed by board minutes, and (c) some plans don't publish committee minutes separately from main board minutes.

### Month 2 (June 2026): Predictive engine v1 + relationship graph

**Week 1:** plan_stakeholders schema + scrapers for staff directories (top 10 plans).
**Week 2:** Predictive engine components 5a-5c (allocation gap, pacing trajectory, commitment cycle).
**Week 3:** Predictive engine components 5d-5e (niche matching, cross-source weighting).
**Week 4:** UI work - predictive ranking page + stakeholder view + audit pass.

End of Month 2: Working "predict who allocates next to user's niche" page with named contacts. First demo-ready slice.

### Month 3 (July 2026): Plan expansion to 50

**Week 1-2:** Build BoardDocs + Granicus generic scrapers.
**Week 3:** Onboard 15 plans via generic scrapers.
**Week 4:** Onboard remaining 15 plans, audit pass.

End of Month 3: 50 plans active.

### Month 4 (August 2026): Polish + first design partner

**Week 1:** Audit pass on all 50 plans, quality over quantity.
**Week 2-3:** Design partner outreach + 1-3 conversations + iterate.
**Week 4:** Decision on Month 5+ direction based on design partner feedback.

End of Month 4: One design partner using Allocus, willingness-to-pay validated.

---

## 12. The classifier prompts (existing + extending)

v1 had a single classifier prompt for signal extraction. v3 has multiple:

1. **Consultant classifier** (existing) - extracts `plan_consultants` from CAFR + board minutes.
2. **Signal classifier** (existing, multiple variants) - extracts T1/T2/T3 signals.
   - Board-minute variant (`v2.x-board-minutes`) - the original.
   - Press-release variant (`v1.0-pr`, Day 2) - sister prompt with shared schema, calibrated for the high-noise press release shape.
   - GP press release variant (existing) - flips the perspective from LP commitment to GP fund close.
3. **CAFR allocation extractor** (existing, multiple plan-specific calibrations: `v1.0-cafr` through `v1.3-cafr`).
4. **IPS allocation extractor** (`v1.0-ips`, Day 3) - sister prompt to the CAFR allocation extractor, simpler because IPS has one canonical target table per plan.
5. **Cross-source verifier** (`v1.1-allocation`, Day 6) - allocation-allocation pairings only at v1.x. Returns `confirms` / `partially_confirms` / `policy_changed` / `conflicts` / `unrelated`. Each future record-type pairing requires its own semantic spec before the prompt is written (see Section 5e and `docs/architecture/cross-source-verification-semantics.md`).
6. **Stakeholder classifier** (Month 2) - extracts staff directories from plan websites and presentations from board minutes.

All prompts follow institutional standard: NULL is honest disposition, never default to a value when truth is unknown, false positives destroy trust. Each prompt commits its `prompt_version` to the row it produces (see Section 10 prompt_version conventions).

---

## 13. File structure

Existing structure preserved (see lp_signal_build_spec_v1_2026-04-21.md section 8). New additions in Month 1-4:
lp-signal/
├── lib/scrapers/
│   ├── press-release/        # New - Month 1 Week 1
│   │   ├── calpers.ts
│   │   ├── calstrs.ts
│   │   ├── nyscrf.ts
│   │   ├── ma-prim.ts
│   │   └── oregon.ts
│   ├── ips/                  # New - Month 1 Week 1
│   ├── pacing/               # New - Month 1 Week 3
│   ├── committee/            # New - Month 1 Week 3
│   ├── quarterly/            # New - Month 1 Week 4
│   ├── staff-directory/      # New - Month 2 Week 1
│   ├── boarddocs-generic.ts  # New - Month 3
│   └── granicus-generic.ts   # New - Month 3
├── lib/predictive/           # New - Month 2
│   ├── allocation-gap.ts
│   ├── pacing-trajectory.ts
│   ├── commitment-cycle.ts
│   ├── niche-match.ts
│   └── verify-cross-source.ts
├── lib/classifier/
│   ├── prompts/
│   │   ├── consultants.ts    # Existing
│   │   ├── signals.ts        # Existing
│   │   ├── stakeholders.ts   # New - Month 2
│   │   ├── ips.ts            # New - Month 1
│   │   └── cross-source.ts   # New - Month 1
└── docs/
├── allocus-mission-and-context.md  # Strategic context (efa482d)
├── e-roadmap.md                    # Existing tactical roadmap
└── audits/                         # 5-audit framework

---

## 14. Commercial notes

**Pricing:** $12-18k/year per seat. Anchor against Preqin ($30k), PitchBook ($25k). Position on actionability and predictive accuracy, not data volume.

**Launch customers (priority):**
- Mid-market infrastructure: Stonepeak, Meridiam, Antin, DIF
- Mid-market PE: Thoma Bravo, Vista, Advent, Genstar, Hellman & Friedman
- Placement agents: Eaton Partners, PJT Park Hill, Lazard, Moelis

**North Star metric:** Prediction accuracy. Measured as: of the predictions Allocus makes about which plans will commit to a given asset class in the next 6 months, what percentage are correct? Target 60%+ at v1 (vs. ~10-15% baseline of "all 50 plans equally likely").

Secondary metric: Signals-to-meeting ratio. Once design partners use it, track: of signals Allocus delivers, what percentage led to a meeting that resulted in an LP conversation? Target 5%+ for the tool to pay for itself at $15k.

---

## 15. Operating principles (from 5-audit institutional standards)

These apply to all build work:

1. No "may be wrong" left standing - every defect resolved or escalated
2. Pattern-check every defect for siblings (LACERA aggregate-line, NYSCRF Aksia split surfaced this way)
3. Scope limitations section in every audit doc
4. Reproducibility metadata: commit hash + UTC timestamp + auditor identity
5. Resolution tracking explicit per finding, dated
6. Wrong data shown to users = P1, not P2
7. NULL is honest disposition - never default to a value when the truth is unknown
8. Pattern check after every fix
9. Audit doc updates dated at moment of resolution

---

## 16. Backlog

Tracked items deferred from Week 1, surfaced for Month 1-2 work:

### Type 4 Relationship Signal (Month 2)

Press release ingestion in Week 1 surfaced a content pattern that doesn't fit T1/T2/T3:

- "Aggregate program rollups" - press releases that name specific funds without per-fund dollar disclosures. Example: "CalPERS Climate Solutions surpass $53 billion. Funds include TPG Rise Climate, West Street Climate Credit, Generation IM Sustainable PE II..."
- These are valuable LP intelligence (they confirm an LP-GP relationship exists) but are not commitment signals (no specific dollar amount per fund).
- The right home for these is the relationship graph (Section 6), not the T1/T2/T3 signal stream. Defer build to Month 2.

Field shape (preliminary):
- `plan_id`, `gp_name`, `fund_name` (when stated), `program_label` (e.g., "Climate Solutions"), `aggregate_amount_usd` (the program total, not per-fund), `source_document_id`, `source_excerpt`, `prompt_version`.

### Classifier per-signal validation refactor (Month 2)

Current behavior: one bad signal in a doc fails the whole doc's Zod validation, marking the doc `processing_status='error'`. As of 2026-04-30, 13 board-minute docs sit in error state for this reason (8 are validation failures with `null` in a required numeric field; 3 are `out_of_scope: transcript`; 2 are `too_long`; 1 is "Expected array, received string").

Proposed fix: per-signal validation. Drop bad signals, keep good signals, surface the validation error per-signal in a debug log rather than failing the whole doc.

Severity: P2 (architectural quality issue, not data correctness - the affected docs would have produced 0 signals anyway in most cases).

### Verifier v1.2 calibration (Month 2)

The Day 6 v1.1 cross-source verifier produced 1 false positive in 29 pairs (CalPERS Public Equity / Cap Weighted misread as parent-level rather than sub-sleeve). The sibling pair (CalPERS Public Equity / Factor Weighted) was correctly classified, so the prompt CAN handle the pattern. A v1.2 iteration could explicitly enumerate "X Weighted" / "X Active" / "Smart Beta" labels as sub-sleeve indicators. Defer until a second occurrence shows up in real data.

### Sub_class normalization layer (Month 2-3)

`buildVerifiablePairs()` assumes `sub_class` labels are canonical across plans. If two plans use functionally equivalent labels with different strings (e.g., "MBS" vs "Mortgage-Backed Securities"), the structural sub_class filter would drop them silently. No such case exists in the current 3-plan dataset, but Week 2's plan expansion makes this a near-term concern. Likely solution: a `sub_class_canonical` mapping table or a pre-classifier normalization step.

---

## 17. Open questions for v4

The following will be resolved by Month 2-4 and trigger v4 of this spec:

- What's the minimum viable predictive accuracy for first paid customer?
- Pricing model details: annual seat, firm site license, or freemium?
- Predictive engine architecture: prompt-based stays the answer, or move to trained model?
- Canadian plan coverage timing.
- Whether to incorporate Allocus as separate entity.
- Press release stream value reassessment after Week 2 (are smaller plans more deal-disclosing than CalPERS / CalSTRS / Oregon)?

---

## Change log

- v3.0 (2026-04-30): End-of-Week-1 update. Press release framing corrected (0% T1 yield across 3 plans). IPS established as the predictive-layer high-yield stream. Cross-source verification reframed as a per-pairing semantic problem with v1.1 temporal-pre-filter + `policy_changed` verdict. Pacing-as-separate-stream retired. Type 4 Relationship Signal and classifier per-signal validation refactor added to backlog. Section 10 schema corrected to match the actually-shipped `source_verifications` table (record-pair design vs the v2 signal-anchored design).
- v2.0 (2026-04-29): Major rewrite reflecting profile-first + predictive product. 4-month roadmap. 7-stream document model. Predictive layer specification. Relationship graph addition. Cross-source verification primitive specified. Preserved at `lp_signal_build_spec_v2_2026-04-29.md`.
- v1.0 (2026-04-21): Initial spec for daily LP signal feed. Preserved at `lp_signal_build_spec_v1_2026-04-21.md`.
