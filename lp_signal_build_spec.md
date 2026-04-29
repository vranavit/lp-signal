# Allocus - Build Spec v2

**Product:** Predictive LP intelligence platform for private markets fundraising teams
**Geography:** US + Canada public pensions (~350 plans available, 50 plan target by Month 3, 20 today)
**Buyers:** PE/infra/credit IR and fundraising teams at $500M-$10B AUM firms
**Owner:** Vitek Vrana / Bloor Capital
**Spec version:** v2.0 (2026-04-29)
**Supersedes:** lp_signal_build_spec_v1_2026-04-21.md

---

## 0. What changed from v1

v1 was written 2026-04-21 and described a signal-feed product: scrape board minutes daily, classify into commitment / allocation-change / pacing-change events, push to a dashboard. The actual build evolved into a profile-first product with a predictive layer, because:

1. Pension profiles (allocation gap, consultants, board) are richer signal than commitment events alone
2. Cross-source verification produces higher-confidence intelligence than single-source signal extraction
3. The unfunded-budget metric (NAV × allocation gap, in dollars) is a more powerful sales hook than "saw a commitment last week"
4. IR teams need to know who to contact, not just what happened

v2 reflects what was actually built (Days 1-18) and what gets built next (Months 1-4). The original v1 sits at lp_signal_build_spec_v1_2026-04-21.md for historical reference.

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

| Stream | What it produces | Update frequency | Today (20 plans) |
|---|---|---|---|
| 1. Board minutes | Commitments, votes, allocation discussions | Monthly/quarterly | 12/20 plans |
| 2. CAFR/annual report | Allocations, fees, performance, consultants | Annually | 19/20 plans |
| 3. Investment Policy Statement (IPS) | Targets, pacing, manager criteria | When changed | 0/20 plans |
| 4. Quarterly performance reports | Manager-level detail, mid-cycle commitments | Quarterly | 0/20 plans |
| 5. Asset class committee minutes | PE/RE/Infra-specific deal flow | Monthly | 1/20 (LACERA) |
| 6. Pacing plan | Annual deployment plans by asset class | Annually | 0/20 plans |
| 7. RFP/press releases | Consultant changes, commitments before official disclosure | Ongoing | 0/20 plans |

**Plus secondary sources** (P&I, IPE, FundFire, Markets Group): third-party confirmation, commitments often surface here days before official documents. Currently 0% scraped; will be added in Month 1-2.

**Cross-source verification logic:**
- Single-source signal: confidence weight 1.0
- Two-source confirmation (e.g., press release + board minutes): weight 1.5
- Three+ sources (press + minutes + CAFR): weight 2.0
- Sources conflict: signal flagged, not auto-resolved

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
score =
base_type_score (40 if Type 1 else 25 if Type 2 else 10 if Type 3)

size_multiplier (0-30 based on dollar magnitude)
recency_multiplier (0-15 based on days since signal date)
plan_tier_multiplier (0-15 based on plan AUM)
verification_multiplier (0-10 based on cross-source confirmation count)


This is prompt-driven, not a trained model at v1. The classifier outputs the score directly. Move to trained model when feedback loop produces enough labeled data (Month 6+).

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

-- Cross-source verification tracking (Month 1)
CREATE TABLE source_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id uuid REFERENCES signals(id),
  verifying_document_id uuid REFERENCES documents(id),
  verifying_stream text NOT NULL,
  verification_type text CHECK (verification_type IN ('confirms', 'partially_confirms', 'conflicts')),
  notes text,
  created_at timestamptz DEFAULT now()
);

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

**Week 1:** Press releases + IPS for 5 plans (CalPERS, CalSTRS, NYSCRF, Mass PRIM, Oregon PERS) + cross-source verification primitive.

**Week 2:** Same 2 streams for remaining 15 plans (where source URLs exist).

**Week 3:** Pacing plans + asset class committee minutes for top 10 plans.

**Week 4:** Quarterly performance reports for top 10 plans + Month 1 audit pass.

End of Month 1: 20 plans × 7 streams target. Realistic actual: 20 plans × 4-5 streams given source availability.

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

v1 had a single classifier prompt for signal extraction. v2 has multiple:

1. **Consultant classifier** (existing - extracts plan_consultants from CAFR + board minutes)
2. **Signal classifier** (existing - extracts the 3 signal types)
3. **Stakeholder classifier** (new, Month 2 - extracts staff directory from plan websites + presentations from board minutes)
4. **Cross-source verifier** (new, Month 1 - takes 2 candidate signals from different streams, decides if they're the same event)
5. **IPS extractor** (new, Month 1 - extracts target allocations + pacing parameters + manager criteria)

All prompts follow institutional standard: NULL is honest disposition, never default to a value when truth is unknown, false positives destroy trust.

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

**Do NOT sell to ISQ.** Hard rule. Per v1 commercial notes:
- Carve out blanket exclusion on selling to or soliciting ISQ before starting
- Have explicit Outside Business Activity (OBA) conversation with ISQ Compliance
- All Allocus work outside ISQ working hours, on personal equipment
- This protects you and lets you honestly say "I built this for the broader PE market, not ISQ specifically."

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

## 16. Open questions for v3

The following will be resolved by Month 2-4 and trigger v3 of this spec:

- What's the minimum viable predictive accuracy for first paid customer?
- Pricing model details: annual seat, firm site license, or freemium?
- ISQ OBA conversation timing and outcome
- Predictive engine architecture: prompt-based stays the answer, or move to trained model?
- Canadian plan coverage timing
- Whether to incorporate Allocus as separate entity

---

## Change log

- v2.0 (2026-04-29): Major rewrite reflecting profile-first + predictive product. 4-month roadmap. 7-stream document model. Predictive layer specification. Relationship graph addition. Cross-source verification.
- v1.0 (2026-04-21): Initial spec for daily LP signal feed. Preserved at lp_signal_build_spec_v1_2026-04-21.md.
