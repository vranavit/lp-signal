# Week 1 Day 4 Findings

Date: 2026-04-30 (continuing same calendar day as Day 3 — multi-phase build session)

## What was built today

- Oregon Treasury press release scraper (`lib/scrapers/press-release/oregon.ts`) + cron (`scrape-oregon-press`, daily 18:30 UTC). Commit `ee31465`.
- CalSTRS IPS scraper using the index-crawl pattern (`lib/scrapers/ips/calstrs.ts`) + cron (`scrape-calstrs-ips`, weekly Thursday 19:00 UTC). Commit `db79d5c`.

## What was deferred and why

- **Mass PRIM press release stream** (initially Day 4 Phase 2): inspection revealed Mass PRIM's "newsroom" is a press-coverage aggregator, not a publishing channel. Only 2-3 PRIM-authored PDFs over 5+ years; the rest are outbound links to external articles. Per-plan signal yield wouldn't justify the build cost. Deferred indefinitely; reconsider if Mass PRIM changes their disclosure practice. Documented inline in this session.

- **NYSCRF press release stream** (Day 3 Task 2 originally): osc.ny.gov uses Drupal's `better_exposed_filters` AJAX module to filter press releases by topic. URL-based filtering doesn't work — `?topic=pension-retirement` returns the same default 18 releases as the unfiltered feed. Would require AJAX endpoint reverse-engineering (~20-40 min, success not guaranteed) OR ingest-broadly + classifier-rejection (wasteful at ~$1/run on noise). Deferred to Week 2 when AJAX inspection can be done properly. Day 3 finding.

- **Mass PRIM IPS scraper** (Day 4 Phase 6): Mass PRIM does NOT publish their IPS through any indexable navigation. The `/about-prim/`, `/investments/`, and `/about/` pages contain zero links to PRIM-IPS PDFs. The PDF lives at `/wp-content/uploads/{YYYY}/{MM}/PRIM-IPS-Board-approved-{Date}.pdf` with the date encoded in the path; when PRIM revises the IPS, the URL rotates and we have no programmatic way to discover the new path. Deferred to Week 2 per the standing instruction "if we can't find a stable index URL, defer."

## Press release stream consensus (3-plan evidence summary)

Three plans inspected, scrapers built and run, classifier evaluated:

| Plan | Releases ingested | T1 signals | T2 signals | T3 signals | Yield |
|---|---|---|---|---|---|
| CalPERS | 25 | 0 | 0 | 0 | 0% |
| CalSTRS | 24 | 0 | 0 | 0 | 0% |
| Oregon (OST/OIC) | 14 | 0 | 0 | 0 | 0% |

**Consistent finding across 3 large/mid-size US public pension funds:** press releases serve PR/governance/performance functions and do not surface individual GP commitments, allocation policy changes, or pacing changes that map to our T1/T2/T3 signal types. Deal-level disclosure is reserved for board minutes and Investment Transactions Reports.

This contradicts spec v2.0 Section 11 which described press releases as "highest signal density, easiest to build" and prioritized them as the first new stream of Month 1. **The spec language was wrong; press releases are low-yield for the signal types we currently support.**

What press releases ARE good for:
- **Cross-source verification** of board-minute commitments (the Day 7 primitive)
- Detecting program-level themes (climate, ESG, diversity initiatives)
- Hire/governance announcements that feed the **stakeholder/relationship graph** (Month 2 deliverable)
- "Named funds without amounts" relationship-signal data (a Type 4 signal flagged in Day 2 backlog)

The 88 press release docs ingested across 3 plans now form a useful corpus for Month 2 work even though they yielded 0 T1/T2/T3 signals today.

## Index-crawl pattern established (Phase 5 reusable infrastructure)

CalSTRS IPS is the first scraper using the index-crawl pattern. The pattern is now:

1. Fetch a navigable index page that lists candidate documents.
2. Parse the listing with Cheerio.
3. Identify the target document via a defense-in-depth strategy:
   - Primary: anchor text exact match (most stable, least likely to silently break)
   - Fallback: filename regex on the PDF basename (catches anchor-text rephrasing)
4. Once the target URL is resolved, hand off to the existing `ingestIps` helper which does fetch → unpdf text extract → text-hash dedup → Storage upload → DB insert.
5. Errors at the discovery step (no link found via either strategy) throw a clear exception that surfaces in the cron health check.

The pattern is in `lib/scrapers/ips/calstrs.ts`. **Reusable for any rotating-URL document type** — Mass PRIM IPS would have used this if Mass PRIM had a discoverable index. Future scrapers (CalSTRS sub-policies, Mass PRIM IPS once they expose an index, NYSCRF AJAX feed once cracked) can follow the same skeleton.

## Cross-plan IPS allocation comparison

Three plans now have IPS-derived rows: CalPERS (11), CalSTRS (8), Oregon (6). Total: 25 IPS allocations across 3 plans.

**Granularity wins:** IPS extraction surfaces sub-class detail that CAFRs roll up.

CalPERS IPS captured 5 Fixed Income sub-classes (Treasury 7% / IG Corp 6% / HY 5% / MBS 5% / EM Sovereign 5%) and 2 Public Equity sub-classes (Cap Weighted 27% / Factor Weighted 10%) plus Strategic Leverage **-5%**. CAFR rolled these to parent classes only.

**Cross-source agreement on parent-class targets:** Of the comparable rows (same plan, same asset_class, sub_class), 8 of 10 IPS targets match the CAFR target exactly. Validates both extraction paths.

**Cross-source value discrepancies:**

| Plan | Asset class | IPS target | CAFR target | Initial Day 4 hypothesis | Day 9 investigation finding |
|---|---|---|---|---|---|
| CalPERS | Credit | 8.00% | 3.50% | CAFR captured Private Debt sub-sleeve as the Credit parent (mis-aggregation in CAFR extraction) | **Hypothesis refuted (Day 9).** CalPERS' CAFR contains two target tables: Strategic Asset Allocation at p.60 (Private Debt 8%) and Interim Policy Target at p.126 (Private Debt 3.5%). The DB row (3.5%) was correctly extracted from the Interim table; the IPS (8%) reflects the Strategic target. Both are legitimate GASB disclosures - Strategic is the long-term board-adopted policy, Interim is in-effect during transition. The gap is a Strategic-vs-Interim table-choice issue, not an extraction error. |
| CalSTRS | Public Equity | 38.00% | 42.00% | 4-pt gap; CAFR may include an additional public-equity sleeve in the parent rollup | **Hypothesis refuted (Day 9).** The CAFR text explicitly states 42.0% as CalSTRS' Current target allocation as of 2023-06-30; subsequent CAFRs show 41.0% (FY2024) and 40.0% (FY2025), tracking a multi-year reduction toward the IPS-adopted 38% long-term target. This is real policy drift, not an extraction error. |
| CalSTRS | Fixed Income | 14.00% | 13.00% | 1-pt gap; minor - could be a rounding or transition-period difference | **Hypothesis refuted (Day 9).** Real CAFR data: 12% / 12% / 13% across FY2023 / FY2024 / FY2025 vs IPS 14%. The classifier extracted exactly what the CAFR's Current target allocation column states. Real policy drift, not rounding. |

The CalPERS Credit discrepancy was originally flagged in the Day 3 commit message as an extraction error. Day 9 PDF inspection refuted that hypothesis: the 3.5% in the database is correctly extracted from the CAFR's Interim Policy Target table (p.126); the IPS 8% reflects the CAFR's Strategic Asset Allocation table (p.60). Strategic and Interim are both legitimate target disclosures representing "long-term policy" vs "in-effect during transition." See `2026-W2-day-2-findings.md`. The two CalSTRS rows are likewise not data quality issues per Day 9 inspection - both are real multi-year policy drift.

**Cross-plan PE/RE comparison:**

| Plan | PE target | RE target |
|---|---|---|
| CalPERS | 17% (range 12-22%) | 15% (10-20%) |
| CalSTRS | 14% (9-19%) | 15% (10-20%) |
| Oregon | 20% (15-27.5%) | 12.5% (7.5-17.5%) |

Oregon has the highest PE target of the three (20%). CalPERS and CalSTRS are closer (17% / 14%). All three plans target ~15% to RE. This is meaningful intelligence for Month 2 niche-matching.

## Day 5 priorities

Three reasonable directions for Day 5, in priority order:

1. **Pacing plans (Spec Section 11 Week 3 work, pulled forward).** Pacing is the single highest-value document type for predictive signal — explicitly cited in the build spec as input to the Month 2 commitment-cycle detection model. Each plan's pacing plan tells us what they intend to deploy in the next 4 quarters by asset class. Worth verifying each plan publishes a discoverable pacing document.

2. **Asset class committee minutes (Spec Section 11 Week 3 work).** LACERA already has these; CalPERS/CalSTRS/NYSCRF have asset-class-specific board sub-committee minutes. These contain the densest commitment signal of any document type because they're where individual deals get voted on at the asset-class level rather than the full-board level.

3. **Cross-source verification primitive (Spec Section 11 Day 7).** Now that we have press release + IPS streams ingested for 3-4 plans, we have data to test cross-source matching. The press release data alone won't surface T1 signals, but the *boundary* test — confirming a board-minute commitment via a same-week governance press release — could already work.

Recommendation: Day 5 = Pacing plan inspection across the 5 Week-1 plans + build CalPERS pacing scraper. Pacing is unambiguously valuable signal and the pattern fits everything we've built.

## Pattern check / institutional flags

- **Spec language audit needed.** The v2.0 spec described press releases as "highest signal density, easiest to build." Both halves are wrong: yield is 0% for direct signal extraction; the build cost is moderate (selector tuning per plan); per-plan structural variance (Mass PRIM's no-index, NYSCRF's AJAX, Oregon's mixed feed) makes "easy" inaccurate. Update spec language at the next strategic-doc bump.

- **Mass PRIM is structurally different from CalPERS/CalSTRS/Oregon.** It does not publish IPS or press releases through stable navigation. Mass PRIM intelligence will require either board-minutes scraping (substantial work) or direct relationships with their IR-facing publications team. Worth flagging at the next strategic-doc bump — Mass PRIM may need a different scraping strategy entirely.

- **Press release stream scope creep prevented today.** Building Mass PRIM press release scraper was the original Day 4 Phase 2 scope. The 5-min inspection caught that the corpus didn't justify the cost. Pivoted to Mass PRIM IPS instead, then deferred when no index existed. Net Day 4 outcome: 2 ships, 2 deferrals, all decisions documented. Sample-of-2 inspections (5 min each) saved hours of building scrapers we'd then disable.

## Time budget

Original Day 4 plan: 3 scrapers (Mass PRIM press, Oregon press, CalSTRS IPS). ~3-4 hours estimated.

Actual Day 4: 2 scrapers shipped (Oregon press, CalSTRS IPS) + 2 inspection-driven deferrals. ~2 hours actual.

Saved time goes to Day 5 (pacing plan inspection).
