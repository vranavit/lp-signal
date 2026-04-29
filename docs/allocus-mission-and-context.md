# Allocus: Mission, Context, and Build State

**Owner:** Vitek Vrana
**Document version:** v1.0 (2026-04-29)
**Purpose:** Single source of truth for AI tools (Cowork, Claude Code, fresh chats) to understand what Allocus is, where it's headed, and how to help build it.

---

## What Allocus is

A predictive LP intelligence platform for private markets fundraising teams.

An IR person opens Allocus and sees: which pension plans will allocate to their specific niche soon, who to contact at each plan, and what to say. The platform replaces the manual workflow of scanning pension board minutes, parsing CAFRs, and hunting for warm intros.

Live at allocus.com.

## The mission stated precisely

**Three components must work together:**

1. **"Will allocate soon"** - Predictive signal generated from continuous monitoring of 7-10 document streams per pension plan. The platform identifies plans likely to commit to a given asset class within a definable forward window (3-12 months).

2. **"To my niche"** - Asset-class and strategy filtering against each plan's unfunded budget (target allocation × NAV minus current commitments). The platform matches user's fund characteristics (asset class, ticket size, geography, strategy) to plans whose budget gaps best fit.

3. **"Who to contact"** - Relationship intelligence layer surfacing the right contact at each plan: the consultant running the relevant search, the board member chairing the relevant committee, the staff member responsible for the asset class.

## Why this matters

IR teams at mid-market PE/infra/credit GPs ($500M-$10B AUM) currently waste 10+ hours per week on manual pension research. Tools like Preqin and Pitchbook are quarterly-stale and don't predict; tools like LinkedIn are noisy and don't have institutional structure. Allocus fills the gap with continuous, structured, predictive intelligence.

Pricing anchor: $12-18k/year per seat, positioned against Preqin ($30k) and PitchBook ($25k) on actionability, not data volume.

---

## The 7-10 document streams per plan

The full institutional 360 degree view requires monitoring multiple document types per plan, with cross-source verification. Current state shows ~28% coverage of this requirement.

| Stream | Purpose | Update frequency | Today |
|---|---|---|---|
| Board minutes | Commitment announcements, votes, allocation discussions | Monthly/quarterly | 12/20 plans |
| CAFR/annual report | Allocations, fees, performance, consultants, audited financials | Annually | 19/20 plans |
| Investment Policy Statement (IPS) | Target allocations, pacing parameters, manager selection criteria | When changed | 0/20 plans |
| Quarterly performance reports | Manager-level detail, mid-cycle commitments | Quarterly | 0/20 plans |
| Asset class committee minutes | PE/RE/Infra-specific deal flow | Monthly | 1/20 plans (LACERA only) |
| Pacing plan | Annual deployment plans by asset class | Annually | 0/20 plans |
| RFP/press releases | Consultant changes, fund commitments before official disclosure | Ongoing | 0/20 plans |
| Secondary sources (P&I, IPE, FundFire, Markets Group) | Third-party confirmation, lead time on commitments | Ongoing | Not scraped |

Cross-source verification is critical: when 2+ streams confirm the same signal, weight increases. When sources conflict, the platform flags rather than picking.

## Current state of the build

**As of end of Day 18 (2026-04-29):**

- 20 active pension plans, North American public pensions
- 5 plans continuously scraped at high volume (CalPERS, Oregon PERS, Virginia RS, NJ DOI, Minnesota SBI)
- 10 plans continuously scraped at low volume (CalSTRS, LACERA, Mass PRIM, NYSCRF, Michigan SMRS, PA PSERS, WSIB, NYSTRS, TRS Illinois)
- 5 plans manual-only (Florida SBA, TRS Texas, Colorado PERA, Wisconsin SWIB, NC Retirement, Ohio PERS) due to bot walls or no public document index
- 422 documents ingested across all plans
- 75 plan-consultant relationships with full source provenance, fee/period data, and audit trail
- 74 pension allocations recorded
- 75 signals classified
- Daily ingestion + classification + alerting via 15 Vercel cron jobs (at free-tier max)

**What exists:**
- Document ingestion pipeline (HTTP scrapers + parser + classifier)
- Consultant classification with fee_period support (added 2026-04-29)
- Audit infrastructure with 5-audit institutional standard (data integrity, code quality, visual UX, schema, prod readiness)
- CI/CD via GitHub Actions, Supabase CLI migration tracking
- Per-plan profile pages with allocation gap, consultants, signals
- Public landing page at allocus.com

**What does not exist yet:**
- 5 of 7 document streams (IPS, quarterly performance, committee minutes, pacing, press releases)
- BoardDocs/Granicus/CivicClerk generic scrapers (to scale plan count)
- Canadian press release scrapers
- Predictive engine that produces "will allocate soon" output
- Niche-matching against user's fund profile
- Relationship graph (who to contact)
- Feedback loop for prediction accuracy improvement

## The 4-month roadmap

**Month 1 (May 2026): Stream depth on existing 20 plans**

Add the 5 missing document streams to the 20 plans currently covered. Order: press releases first (highest signal density, easiest to build), then IPS, then pacing plans, then committee minutes, then quarterly performance reports.

End of Month 1: 20 plans × 7 streams = 140 active scrapers. The full 360 degree view on a focused universe.

**Month 2 (June 2026): Predictive engine v1 + relationship graph**

With 7 streams flowing for 20 plans, build:
- Allocation gap calculator (polish existing)
- Pacing trajectory model (last 4 quarters → projected next 4)
- Commitment cycle detection (lag from RFP to allocation per plan)
- Niche-matching (user fund profile → ranked plan list)
- Cross-source verification weighting

Plus the relationship graph foundation:
- plan_stakeholders schema (CIO, asset class heads, deputy CIOs, committee chairs)
- Scrape staff directories from each plan website
- Extract board member attendance from board minutes
- Link existing consultant data to relevant asset class searches

Output: a single page that says "If you raise an X fund right now, here are the N plans most likely to commit in the next 6 months, with dollar amounts and the right contact at each plan."

**Month 3 (July 2026): Plan expansion to 50**

Build BoardDocs/Granicus/CivicClerk generic scrapers. These platforms host hundreds of pension plans; one generic scraper unlocks 30-50 plans. Bring total coverage from 20 to 50.

**Month 4 (August 2026): Polish + first design partner**

Audit pass on all 50 plans. Quality over quantity. Find one design partner (mid-market PE/infra/credit GP IR team) and get them using the platform. Their feedback drives Month 5+ direction.

## Critical constraints

**ISQ start date conflict:**
Vitek joins I Squared Capital (ISQ) in June 2026 as a North American Asset Management analyst working on AI agents. ISQ is an infrastructure PE firm. Allocus is sold to PE/infra/credit IR teams - including potential conflict-of-interest concerns. Per the original build spec:

- Do NOT sell Allocus to ISQ
- Do NOT solicit ISQ contacts as design partners or customers
- Have an explicit Outside Business Activity (OBA) conversation with ISQ Compliance before starting; carve out a blanket exclusion on selling to or soliciting ISQ
- All work on Allocus while at ISQ should be on personal time, personal equipment, and outside ISQ working hours

**Vercel cron limit:**
Currently at 15/15 free-tier cron jobs. Adding new streams will require either:
- Vercel Pro upgrade ($20/month)
- Cron consolidation (one job fans out to many scrapers)
- External scheduler (GitHub Actions or VPS)

**Solo builder pace:**
Sustainable pace ~20-30 hours/week of focused work. The 4-month plan assumes this rate. If pace drops, timeline extends.

## Operating principles

**Institutional standards locked in (from 5-audit pass):**
1. No "may be wrong" left standing - every defect resolved or escalated
2. Pattern-check every defect for siblings (LACERA aggregate-line bug, NYSCRF Aksia mandate-split bug both surfaced this way)
3. Scope limitations section in every audit doc
4. Reproducibility metadata: commit hash + UTC timestamp + auditor identity
5. Resolution tracking explicit per finding, dated
6. Wrong data shown to users = P1, not P2
7. NULL is honest disposition - never default to a value when the truth is unknown

**Build discipline:**
- Each phase is a self-contained session (don't carry-over partial work)
- Document DB-only changes in markdown (the audit trail isn't in git unless we put it there)
- Pattern check after every fix (sibling defects exist)
- Audit doc updates dated at the moment of resolution

**Communication style preferences:**
- Plain language, short sentences, no em dashes (use hyphens)
- One Terminal command at a time, paste output between
- Numbers-first analysis
- Honest assessment over optimistic framing
- Push back on bad ideas

## Tools and environment

- **Codebase:** /Users/vitekvrana/Desktop/lp-signal
- **GitHub:** github.com/vranavit/lp-signal
- **Stack:** Next.js 14 + Supabase Postgres + Vercel + Anthropic API (Sonnet for classification)
- **Auth:** Supabase magic link
- **Migration tracking:** Supabase CLI (`supabase db push`, with `--include-all` flag for out-of-order migrations)
- **DB access pattern:** `set -a && source .env.local && set +a && node -e "..."` (psql not installed locally)
- **Production tester:** Nicholas Cheung (nicholas.cheung.149@gmail.com), user role
- **Working AI tools:** Claude Code (terminal), Claude.ai chat, Cowork (desktop)

## Decisions made and not yet made

**Decisions made:**
- Product is profile-first + predictive layer, not signal feed (pivot from original spec)
- 4-month timeline at ~25 hrs/week
- Vercel Pro acceptable when cron limit binds
- Press releases first stream to add (Days 2-4 of Week 1)
- IPS second stream (Days 5-6 of Week 1)
- Cross-source verification primitive built in Day 7
- No autonomous 24/7 agents (Claude Code with human in loop is the working pattern)
- Audit pass discipline maintained per institutional standards from 5-audit pass

**Decisions not yet made:**
- Which 30 plans to add in Month 3 (depends on BoardDocs/Granicus footprint)
- Pricing model details (annual seat, firm site license, freemium tier?)
- First design partner target (no specific name yet; need warm contact identification)
- ISQ OBA conversation timing (before June or once on the job?)
- Predictive engine architecture details (prompt-based vs. trained model)
- Whether to incorporate Allocus as separate entity or keep as personal project
- Canadian plan coverage timing
- Stakeholder/contact data schema (plan_stakeholders table or extension)

## Open questions

- What's the minimum viable predictive accuracy for first paid customer? (need to define before Month 2)
- How do we measure prediction accuracy without paid customers? (need labeled training data)
- Should there be a free tier to drive adoption, or paid-from-day-one?
- How does the relationship graph (who to contact) get built without manual research per plan?

## How to use this document

**For Cowork or any new AI tool:**
Paste this document as initial context. Tell the AI: "I'm building Allocus per this document. Help me with [today's specific task]."

**For Claude Code sessions:**
Auto-loaded via root CLAUDE.md. The session-start protocol references this document at startup. No manual paste needed.

**For new chats with me (Claude.ai):**
Paste relevant sections at the start. The "Current state of the build" + "Critical constraints" + "Operating principles" sections together give enough context for substantive help.

## How to update this document

This document gets updated at month boundaries (or when major strategic shifts happen). Each update:
- Bumps the version number
- Records the date
- Notes what changed in a "Change log" section at the bottom

Don't update during week-level work - the daily flux belongs in journal entries, not here.

---

## Change log

- v1.0 (2026-04-29): Initial document. Created at end of Day 18 after 5-audit pass + strategic zoom-out conversation that clarified mission as predictive workflow product (not signal feed). Adopted 4-month roadmap, Week 1 plan for press releases + IPS + cross-source verification. Includes stakeholder/contact intelligence as Month 2 deliverable.

---
End of file.
