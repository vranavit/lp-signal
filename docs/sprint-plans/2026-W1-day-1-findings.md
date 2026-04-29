# Week 1 Day 1 Findings

Date: 2026-04-29

## URL verification (Tasks 1+2)

Completed. Findings in docs/sprint-plans/2026-W1-sources.md (commit 0f669d9).

Key takeaways:
- 5/5 IPS are PDFs (no JS rendering needed)
- 3/5 IPS URLs are stable (CalPERS, NYSCRF, Oregon)
- 2/5 IPS URLs rotate by version (CalSTRS, Mass PRIM) - require index-crawl logic
- 4/5 press release pages accessible via HTTP fetch
- 1/5 needs UA spoofing (CalSTRS)
- 0/5 require Playwright

## Schema migration (Task 3)

**Discovery: no migration needed.**

Pre-migration check revealed that documents.document_type CHECK constraint already allows both stream types we need:

- press_release - already allowed (current rows: 0, infrastructure exists)
- investment_policy - already allowed (current rows: 0)

The drafted migration would have silently dropped support for 6 other allowed values (agenda, gp_press_release, annual_report, performance_report, investment_policy, other) including 13 active rows of gp_press_release data. Caught during pre-migration verification.

**Decision (per institutional standards):** Use existing canonical values. Press release scrapers write document_type = 'press_release'. IPS scrapers write document_type = 'investment_policy'.

No new value 'ips' was created. Adding it would create a synonym for investment_policy and risk classifier inconsistency over time (same problem as the consultant data audit findings).

## Cron strategy (Task 4)

Vercel Pro upgrade purchased. Cron limit no longer binding for Week 1.

## Time budget

Original estimate: 3-4 hours
Actual: ~2 hours

Saved time goes to Day 2 work (CalPERS press release scraper).

## Pattern check / institutional flag

Pre-migration verification caught a destructive migration draft. Pattern reinforces: ALWAYS run pre-migration baseline before applying. The 5-audit institutional standard ("verify state before changing it") prevented data loss.

Add to ongoing practice: when designing migrations, always query the existing constraint definition first, not just the rows. Constraints that don't appear in any current data are still load-bearing.
