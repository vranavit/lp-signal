# LP Signal — Claude Code Build Spec

**Product:** Pension board monitoring tool surfacing daily LP signals for PE fundraising teams
**Geography:** US + Canada public pensions (~350 plans)
**Buyers:** PE/infra/credit IR and fundraising teams at $500M–$10B AUM firms
**Owner:** Vitek Vrana / Bloor Capital

---

## 1. Product thesis in one sentence

IR teams at mid-market GPs waste 10+ hours per week manually scanning pension board minutes for commitment signals. LP Signal monitors every public pension in US + Canada daily, extracts three signal types with priority ranking, and delivers them through a dashboard their fundraising analysts can filter by asset class, geography, and ticket size.

---

## 2. Signal definitions (the classifier's job)

The classifier must distinguish these three signal types from noise. Noise includes: performance discussions, generic allocation commentary, consultant presentations without decisions, and forward-looking aspirational language without board action.

### Signal Type 1 — Commitment Announcement (HIGHEST PRIORITY)
A specific dollar commitment to a specific fund or manager.

**Signal example:** "The Board approved a $500 million commitment to KKR Infrastructure Fund V."
**Noise example:** "The Board discussed the infrastructure pipeline."

**Fields to extract:**
- Pension plan name
- GP name
- Fund name
- Commitment amount ($USD)
- Asset class (PE / Infra / Credit / RE / VC / Other)
- Date of approval
- Source document + page number

### Signal Type 2 — Target Allocation Change (MEDIUM PRIORITY)
A formal change to the plan's target allocation percentages.

**Signal example:** "The Board voted to increase the target allocation to private equity from 10% to 13%, to be implemented over the next 24 months."
**Noise example:** "Staff presented long-term allocation scenarios for discussion."

**Fields to extract:**
- Pension plan name
- Asset class affected
- Old target (%)
- New target (%)
- Implementation timeline
- Implied dollar delta (NAV × delta %)
- Source document + page number

### Signal Type 3 — Pacing Plan Change (LOWER PRIORITY)
A meaningful change to annual deployment pacing without target change.

**Signal example:** "Staff presented an updated 2026 pacing plan of $2.5B to private markets, up from $1.8B in 2025."
**Noise example:** "Pacing plan review scheduled for Q3."

**Fields to extract:**
- Pension plan name
- Asset class(es) affected
- Prior year pacing ($)
- New year pacing ($)
- Percentage change
- Source document + page number

### Priority ranking formula

Each signal gets a score 0–100. Higher score = higher rank in the dashboard.

```
score =
  40 if Type 1 else 25 if Type 2 else 10 if Type 3
+ size_multiplier  // 0–30 based on commitment/delta $ amount
+ recency_multiplier  // 0–15 based on days since board meeting
+ plan_tier_multiplier  // 0–15 based on plan AUM (CalPERS = 15, small muni = 2)
```

This is prompt-driven, not a trained model. The classifier outputs the score directly.

---

## 3. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Scheduled Jobs (Vercel Cron)           │
│  Daily 06:00 UTC: run scraper → parser → classifier → DB    │
└─────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────┐      ┌──────────────────────┐
│  Scraper Fleet      │─────▶│  Document Store      │
│  (Node.js + Cheerio │      │  (Supabase Storage)  │
│   + Playwright)     │      │                      │
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
│         Claude API (Vision) — Classifier            │
│  Input: PDF as base64                               │
│  Output: JSON array of signals with priority score  │
└─────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────┐
│         Supabase Postgres                           │
│  Tables: plans, documents, signals, users, firms    │
└─────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────┐
│         Next.js 14 Dashboard (Vercel)               │
│  Magic link auth via Supabase                       │
│  Filters: asset class, plan, signal type, $ range   │
│  History view, saved searches, CSV export           │
└─────────────────────────────────────────────────────┘
```

---

## 4. Tech stack

| Layer | Choice | Reason |
|-------|--------|--------|
| Frontend | Next.js 14 (App Router) + Tailwind | Best DX, ships fast |
| Hosting | Vercel | Native Next.js, free tier covers v1 |
| Database | Supabase Postgres | Magic link auth out of the box, free tier generous |
| Storage | Supabase Storage | PDFs cached here, cheap |
| Scraping | Node.js + Cheerio (static) + Playwright (dynamic) | Handles both HTML board pages and JS-rendered portals |
| Document parsing | Claude API (Sonnet) with vision | Per your decision; handles complex layouts |
| Scheduling | Vercel Cron | Free, no infra |
| Email alerts (v2) | Resend | Best Next.js integration |

Estimated monthly cost at v1 scale (50 customers, 350 plans monitored):
- Vercel: $20 (Pro plan for longer cron jobs)
- Supabase: $25 (Pro plan for auth volume)
- Claude API: $300–500 (document processing + signal classification)
- Domain + misc: $15
- **Total: ~$400/month**

Revenue at $15k ARR × 10 customers = $12.5k MRR. Gross margin ~97%.

---

## 5. Data source strategy per plan type

Not all plans publish the same way. Scraper logic needs to branch.

### US public pensions (~300 plans)

**Tier 1 (25 plans, 80% of AUM):** CalPERS, CalSTRS, NYSCRF, NYSTRS, TRS Texas, Florida SBA, Washington SIB, Oregon PERS, Ohio PERS, Ohio STRS, Wisconsin SWIB, Virginia Retirement, NC Retirement, Massachusetts PRIM, Michigan Retirement, Pennsylvania PSERS, SERS Pennsylvania, Maryland SRPS, Minnesota SBI, Connecticut Retirement, New Jersey Investment, Illinois TRS, Illinois SURS, Colorado PERA, Arizona SRS.

These publish regular board minutes as PDFs. Direct scraping works. Build dedicated scrapers for each.

**Tier 2 (~275 plans):** Smaller state and municipal plans. Many use shared board management software (BoardDocs, Granicus, Civic Clerk). Build generic scrapers for each platform.

### Canadian public pensions (~50 plans)

Canadian plans do NOT publish board minutes the same way. Different strategy required:

| Plan | Source | Method |
|------|--------|--------|
| CPPIB | Quarterly results + press releases | RSS feed + press release page scraper |
| OTPP | Annual report + press releases | Press release page scraper |
| CDPQ | Press releases + annual report | Press release scraper (French + English) |
| HOOPP | Annual report only | Manual quarterly check |
| OMERS | Press releases + annual report | Press release scraper |
| PSP Investments | Annual report only | Manual quarterly check |
| BCI | Press releases | Press release scraper |
| AIMCo | Press releases | Press release scraper |

For Canadian plans without board minutes, the signal types shift:
- Type 1 (Commitment) — captured via press releases announcing fund commitments
- Type 2 (Target allocation) — captured from annual report allocation tables (compare YoY)
- Type 3 (Pacing) — captured from annual report commentary on deployment pace

### Data source config schema

Store per-plan config in `plans` table:

```sql
CREATE TABLE plans (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  country text CHECK (country IN ('US', 'CA')),
  aum_usd bigint,
  tier int CHECK (tier IN (1, 2, 3)),
  scrape_method text CHECK (scrape_method IN ('board_minutes', 'press_release', 'annual_report', 'manual')),
  scrape_url text NOT NULL,
  scrape_config jsonb, -- selector rules, pagination, etc.
  last_scraped_at timestamptz,
  active bool DEFAULT true
);
```

---

## 6. The classifier prompt

This is the core IP. It runs after each document is parsed to text.

```
You are an expert pension fund analyst specializing in private markets.
Your job is to extract high-confidence LP allocation signals from pension
board documents. False positives destroy customer trust — when in doubt,
classify as noise.

You will receive a document (board meeting minutes, press release, or
annual report excerpt) from a pension plan. Extract all instances of the
three signal types defined below. Return JSON only.

## Signal Type 1 — Commitment Announcement
A specific dollar commitment to a specific fund or manager that has been
APPROVED by the board (not just presented or discussed).

Required indicators (at least 2):
- Specific dollar amount ($X million/billion)
- Specific GP name (e.g., "KKR", "Blackstone", "Brookfield")
- Specific fund name or asset class
- Approval language ("the Board approved", "motion carried", "approved the commitment")

## Signal Type 2 — Target Allocation Change
A formal vote to change target allocation percentages.

Required indicators (at least 2):
- Specific percentage change (from X% to Y%)
- Specific asset class
- Board action language ("the Board voted", "approved the revised policy",
  "adopted the new asset allocation")

## Signal Type 3 — Pacing Plan Change
An approved change to annual capital deployment pacing.

Required indicators:
- Specific dollar pacing amount for a specific future year
- Comparison to prior year pacing
- Asset class affected

## NOISE (do not extract)
- Performance discussions ("PE returned 12% YTD")
- Consultant presentations without board action
- Aspirational language ("staff recommends exploring")
- Forward-looking discussions without a vote
- Educational sessions on asset classes
- Reviews of existing commitments without new action

## Output format
Return a JSON array. Each signal object must include:
{
  "type": 1 | 2 | 3,
  "confidence": 0.0 to 1.0,
  "priority_score": 0 to 100,
  "summary": "One sentence description",
  "fields": { ... type-specific fields ... },
  "source_page": int,
  "source_quote": "Direct quote from document (max 30 words)"
}

Only include signals with confidence >= 0.75.
Return empty array if no signals found.
```

---

## 7. Database schema (Supabase Postgres)

```sql
-- Pension plans we monitor
CREATE TABLE plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  country text CHECK (country IN ('US', 'CA')),
  aum_usd bigint,
  tier int,
  scrape_method text,
  scrape_url text,
  scrape_config jsonb,
  last_scraped_at timestamptz,
  active bool DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Documents we've ingested
CREATE TABLE documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid REFERENCES plans(id),
  document_type text, -- 'board_minutes', 'press_release', 'annual_report'
  source_url text NOT NULL,
  content_hash text NOT NULL, -- skip re-processing if unchanged
  storage_path text, -- Supabase Storage path
  meeting_date date,
  published_at timestamptz,
  processed_at timestamptz,
  processing_status text CHECK (processing_status IN ('pending', 'processing', 'complete', 'error')),
  error_message text,
  UNIQUE (plan_id, content_hash)
);

-- Extracted signals
CREATE TABLE signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid REFERENCES documents(id),
  plan_id uuid REFERENCES plans(id),
  signal_type int CHECK (signal_type IN (1, 2, 3)),
  confidence decimal(3,2),
  priority_score int,
  asset_class text, -- 'PE', 'Infra', 'Credit', 'RE', 'VC'
  summary text,
  fields jsonb, -- type-specific extracted fields
  source_page int,
  source_quote text,
  commitment_amount_usd bigint,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_signals_created ON signals(created_at DESC);
CREATE INDEX idx_signals_plan ON signals(plan_id);
CREATE INDEX idx_signals_asset_class ON signals(asset_class);
CREATE INDEX idx_signals_type ON signals(signal_type);

-- Customer firms
CREATE TABLE firms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  plan_tier text CHECK (plan_tier IN ('starter', 'pro', 'enterprise')),
  seats int DEFAULT 5,
  active bool DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Users (Supabase Auth handles auth, this extends)
CREATE TABLE user_profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id),
  firm_id uuid REFERENCES firms(id),
  role text CHECK (role IN ('admin', 'user')),
  email text,
  full_name text,
  created_at timestamptz DEFAULT now()
);

-- Saved searches / alerts (v2)
CREATE TABLE saved_searches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id),
  name text,
  filters jsonb, -- { asset_class: [], min_amount: ..., etc. }
  email_frequency text CHECK (email_frequency IN ('off', 'instant', 'daily', 'weekly'))
);
```

---

## 8. File structure for Claude Code

```
lp-signal/
├── app/
│   ├── (auth)/
│   │   ├── login/page.tsx
│   │   └── callback/route.ts
│   ├── (dashboard)/
│   │   ├── layout.tsx
│   │   ├── signals/page.tsx           // main dashboard
│   │   ├── signals/[id]/page.tsx      // signal detail view
│   │   ├── plans/page.tsx             // browse plans
│   │   └── settings/page.tsx
│   ├── api/
│   │   ├── cron/scrape/route.ts       // daily scraper job
│   │   ├── cron/classify/route.ts     // daily classifier job
│   │   └── signals/route.ts           // GET with filters
│   └── layout.tsx
├── lib/
│   ├── supabase/
│   │   ├── client.ts
│   │   └── server.ts
│   ├── scrapers/
│   │   ├── index.ts                   // router
│   │   ├── calpers.ts
│   │   ├── calstrs.ts
│   │   ├── ... (one per Tier 1 plan)
│   │   ├── boarddocs-generic.ts
│   │   ├── granicus-generic.ts
│   │   └── canadian-press-release.ts
│   ├── classifier/
│   │   ├── prompt.ts                  // the classifier prompt
│   │   ├── extract.ts                 // Claude API call
│   │   └── score.ts                   // priority scoring
│   └── types.ts
├── components/
│   ├── SignalCard.tsx
│   ├── SignalFilters.tsx
│   ├── PlanBadge.tsx
│   └── ui/ (shadcn components)
├── supabase/
│   ├── migrations/
│   └── seed.sql                       // initial plan list
├── .env.local
└── package.json
```

---

## 9. Build phases

**Phase 1 — Foundation (Week 1)**
- Next.js + Supabase + Vercel setup
- Magic link auth working
- Basic dashboard shell
- Seed database with 10 Tier 1 US plans
- Build scraper for CalPERS only as proof of concept

**Phase 2 — Classifier (Week 2)**
- Implement Claude API integration with vision
- Build classifier prompt + few-shot examples
- Process 20 historical CalPERS documents, hand-validate output
- Iterate prompt until >85% precision on known signals

**Phase 3 — Scale scraping (Weeks 3–4)**
- Build remaining 24 Tier 1 US scrapers
- Build BoardDocs and Granicus generic scrapers
- Build Canadian press release scrapers for top 8 Canadian plans
- Daily cron job running end-to-end

**Phase 4 — Dashboard polish (Week 5)**
- Filters (asset class, plan, type, $ range, date range)
- Signal detail view with source PDF
- CSV export
- Saved searches

**Phase 5 — Beta (Week 6)**
- Onboard 3 friendly IR teams at no charge
- Daily standups with them for feedback
- Kill false positives aggressively

**Phase 6 — Commercial launch (Week 7–8)**
- Pricing page
- Stripe integration
- First 5 paying customers targeted at $12–18k ARR each

---

## 10. Prompt for Claude Code (paste this to start)

> I want to build LP Signal, a SaaS product that monitors North American pension board meeting minutes and surfaces private markets allocation signals for PE fundraising teams. I have a complete build spec in `lp_signal_build_spec.md`. Read that file first, then help me execute Phase 1.
>
> For Phase 1, build the foundation: a Next.js 14 app with Supabase auth (magic link), the database schema from section 7 of the spec, a basic dashboard shell at `/signals` that reads from the signals table, and the CalPERS scraper as a proof of concept. Use TypeScript throughout. Set up Vercel Cron for a daily job at 06:00 UTC.
>
> Ask me any clarifying questions before writing code. Then walk me through each file as you create it. Don't move to Phase 2 until I confirm Phase 1 is working.
>
> Codex will review your output once you are done.

---

## 11. Commercial notes

**Pricing anchor:** With Preqin at $30k/year, PitchBook at $25k/year, and Pensions & Investments subscriptions at $8-15k/year, your v1 pricing should be $12-18k/year per seat. You are not cheaper than these tools, you are more actionable.

**Launch customers to target:**
- Mid-market infra funds: Stonepeak, I Squared (!), Meridiam, Antin, DIF
- Mid-market PE: Thoma Bravo, Vista, Advent, Genstar, Hellman & Friedman
- Placement agents: Eaton Partners, PJT Park Hill, Lazard, Moelis

**Conflict check for you:** Do NOT sell this to ISQ until you have an explicit OBA conversation approved. In fact, the cleanest path is to carve out a blanket exclusion on selling to or soliciting ISQ directly while you work there. That protects you, and lets you honestly say "I built this for the broader PE market, not ISQ specifically."

**North Star metric:** Signals-to-close ratio. Once you have 10 customers and can track "of the signals we delivered, what percent led to an outreach that resulted in an LP meeting," you have a real pricing lever. The right number is probably 1-3%, which would make the tool 10x ROI at $15k/year.
