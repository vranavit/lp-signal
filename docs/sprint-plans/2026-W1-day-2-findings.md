# Week 1 Day 2 Findings

Date: 2026-04-30

## What was built

- lib/scrapers/press-release/calpers.ts (CalPERS press release scraper)
- lib/classifier/prompts/press-release.ts (plan-side press release classifier)
- lib/classifier/index.ts (added press_release dispatch branch)
- app/api/cron/scrape-calpers-press/route.ts (daily 18:00 UTC cron)
- vercel.json (cron entry)

## Smoke test results

- 37 release links discovered, 25 inserted (initial maxReleases=25)
- 22 of 25 produced 0 signals (correctly rejected as noise)
- 2 of 25 errored on schema validation, fixed via prompt tightening
- 1 of 25 unprocessed in initial run (limit budget exhausted by older queued docs)
- $0.30 in API spend

## Key strategic finding: CalPERS press release T1 yield is 0%

Investigation confirmed CalPERS does NOT press-release individual GP commitments. The 3 most recent CalPERS T1 signals from board minutes (DigitalBridge Partners III, Sixth Street Madrone Strategic Holdings, Ares Senior Direct Lending III) had ZERO corresponding press releases in the -60/+14 day window.

CalPERS reserves deal-level disclosure for the Investment Transactions Report inside board materials. Press releases serve different functions: governance changes, performance milestones, aggregate program themes.

## Implications for Days 3-4 (continuing as planned)

Build remaining 4 press release scrapers but track per-plan signal yield religiously. If 5 of 5 plans show <5% T1 yield, we revisit press release stream priority for Days 5-7.

Reading A (CalPERS is outlier): smaller plans may release more commitment news.
Reading B (all large plans behave like CalPERS): we doubled-down on a low-yield stream.

Sample of 1 plan is insufficient. Continue gathering data.

## New signal type identified for Month 2 backlog

Press releases include "named funds without amounts" content - aggregate program rollups that confirm LP-GP relationships but don't disclose amounts. This is a Type 4 Relationship Signal that doesn't fit the existing T1/T2/T3 framework.

Defer to Month 2 (relationship graph work). Do not build in Week 1.

Examples seen this run:
- "CalPERS Climate Solutions Surpass $53 Billion" - names TPG Rise Climate, West Street Climate Credit, Generation IM Sustainable PE II, B Capital Climate, Copenhagen Infrastructure V, Brookfield Global Transition II-B
- "Climate Solutions Near $60 Billion" - names Brookfield FirstEnergy Transmission, TPG Rise Climate, Octopus Energy

These are valuable LP intelligence - just not the signal shape we currently support.

## Architectural finding for backlog: classifier per-doc validation

Current behavior: one bad signal in a doc fails the whole doc. Should be per-signal validation with bad signals dropped and good signals retained.

Severity: P2 (architectural quality issue, not data correctness)
Defer to: Month 2 when signal volume increases

## Pattern check

Pre-flight check on classifier dispatch caught the gating issue (gp_press_release vs press_release). Pattern reinforces: read the dispatch logic before claiming "should auto-handle." Add to ongoing practice: when adding new document_type values, audit dispatch sites that branch on document_type before declaring infrastructure complete.
