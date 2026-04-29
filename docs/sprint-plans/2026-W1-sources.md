# Week 1 Source URLs - Press Releases + IPS

Generated: 2026-04-29
Status: Day 1 verification

---

## CalPERS

**Press release URL:** https://www.calpers.ca.gov/newsroom/calpers-news
**Press release URL pattern:** `/newsroom/calpers-news/{year}/{slug}` — releases are grouped by year in expandable sections (2026, 2025, 2024 visible). No traditional pagination.
**IPS URL:** https://www.calpers.ca.gov/docs/total-fund-investment-policy.pdf
**IPS document name:** Total Fund Investment Policy
**IPS last published:** 2024 (per CalPERS Investment Policies page; PDF binary returned 2.6 MB and resolves OK; date not extractable from compressed PDF stream by WebFetch)
**Notes:** Stable static URL for IPS — same URL is overwritten when document updates, so a hash check on the PDF is sufficient for change detection. There is also `/newsroom` (parent hub) and `news.calpers.ca.gov` (blog), but the primary press release index is `/newsroom/calpers-news`. Strategy: 1.

---

## CalSTRS

**Press release URL:** https://www.calstrs.com/news-releases
**Press release URL pattern:** Individual releases at `/{slug}` directly off root (e.g., `/calstrs-earns-8-5-net-return-exceeds-benchmark-in-fiscal-year-2024-25`). Confirmed via search results — could not verify via WebFetch.
**IPS URL:** https://www.calstrs.com/files/a6cd5ce3c/InvestmentPolicyStatement05-2025.pdf
**IPS document name:** Investment Policy Statement (current version: 05-2025)
**IPS last published:** May 2025 (per filename)
**Notes:** **BLOCKED — 403 anti-bot.** Both `/news-releases` and `/investment-policies` index returned 403 to WebFetch (no Chrome UA). Matches the existing spec Risk 1 flag. Scraper must spoof `User-Agent: Mozilla/5.0 ...`. **IPS URL is unstable** — path includes a hashed segment (`a6cd5ce3c`) AND a version-dated filename (`05-2025`), so the URL changes on every update. Scraper must crawl `/investment-policies` index for the current "Investment Policy Statement" link rather than hard-coding the PDF URL. Strategy: 1 (URL inventory) + manual verification needed in browser to confirm patterns.

---

## NYSCRF

**Press release URL:** https://www.osc.ny.gov/press (filter to topic "Pension & Retirement")
**Press release URL pattern:** `/press/releases/{year}/{month}/{slug}` — example: `/press/releases/2026/02/dinapoli-state-pension-fund-quarterly-results`. The OSC press feed is the comptroller-wide feed; NYSCRF releases are mixed in with audit, MTA, and other comptroller content. Filter: topic = "Pension & Retirement", or match slug substrings `dinapoli` + (`pension` OR `common-retirement-fund` OR `retirement-fund`).
**IPS URL:** https://www.osc.ny.gov/files/common-retirement-fund/pdf/general-investment-policies.pdf
**IPS document name:** General Investment Policy Statement for the New York State Common Retirement Fund
**IPS last published:** Date not extractable from compressed PDF (~149.5 KB; URL resolves)
**Notes:** Stable static URL for IPS. NYSCRF-specific hub at `/common-retirement-fund` does not have its own press section — links out to general OSC press. Strategy: 2 (followed nav from `/common-retirement-fund` to `/press`).

---

## Mass PRIM

**Press release URL:** https://www.mapension.com/newsroom/
**Press release URL pattern:** Mixed feed. Some items are outbound links to external coverage (Boston Globe, WSJ, Statehouse News). PRIM-issued press releases are PDFs uploaded to `/wp-content/uploads/{YYYY}/{MM}/{filename}.pdf` (example: `/wp-content/uploads/2023/01/Press-Release-1.19.23FINAL.pdf`). Scraper must distinguish PRIM-authored PDFs from outbound external links. The `/newsrooms/` (plural) variant in search results appears to be a stale or redirect URL — canonical is singular `/newsroom/`.
**IPS URL:** https://www.mapension.com/wp-content/uploads/2024/12/PRIM-IPS-Board-approved-December-5-2024.pdf
**IPS document name:** Investment Policy Statement (Board-approved December 5, 2024)
**IPS last published:** 2024-12-05
**Notes:** **IPS URL embeds the approval date in the path**, so the URL changes on every IPS revision. There is no stable "current IPS" URL on the PRIM site that I could find. Scraper must crawl the site (likely the about-prim or newsroom pages) to discover the latest IPS PDF link by filename pattern (`PRIM-IPS-*.pdf`) and pick the most recent. Strategy: 1.

---

## Oregon PERS / Oregon State Treasury

**Press release URL:** https://apps.oregon.gov/oregon-newsroom/OR/OST/Posts
**Press release URL pattern:** `/oregon-newsroom/OR/OST/Posts/Post/{slug}` — example: `/oregon-newsroom/OR/OST/Posts/Post/Oregon-Investment-Council-Reports-Strong-Fund-Performances-in-2025`. Feed covers Oregon Investment Council (OIC) and OPERF announcements alongside general Treasury press. Categories include "Business" (93 posts as of 2026-04-29), which is the relevant filter.
**IPS URL:** https://www.oregon.gov/treasury/invested-for-oregon/Documents/Invested-for-OR-OIC-INV/Investment-Policy-Statement-for-OPERF.pdf
**IPS document name:** Investment Policy Statement for Oregon Public Employees Retirement Fund
**IPS last published:** Date not extractable from compressed PDF (~309.6 KB; URL resolves)
**Notes:** Press feed is at the **`apps.oregon.gov` subdomain** (not the main `oregon.gov/treasury` site). The treasury news landing page (`oregon.gov/treasury/news-data/pages/default.aspx`) is a navigation page that links into the apps.oregon.gov feed; do not scrape the landing page. Stable static URL for IPS — overwritten in place on update. Strategy: 2 (search surfaced both URLs; verified via fetch which is canonical).

---

## Findings summary

| Plan | Press URL | IPS URL | Notes |
|---|---|---|---|
| CalPERS | OK | OK | Stable URLs both, year-grouped press index |
| CalSTRS | **blocked (403)** | **unstable URL** | Anti-bot wall; IPS PDF path includes hash + version date — scraper must crawl `/investment-policies` |
| NYSCRF | OK (filter required) | OK | Press is OSC-wide; filter on topic="Pension & Retirement" or slug pattern |
| Mass PRIM | OK | **unstable URL** | IPS path embeds approval date; scraper must crawl for latest `PRIM-IPS-*.pdf` |
| Oregon | OK | OK | Press feed at `apps.oregon.gov` subdomain; both URLs stable |

---

## Plans flagged "blocked - manual verification needed"

- **CalSTRS press release page** (`/news-releases`) — 403 to WebFetch with no UA. Needs browser verification of pagination (load-more vs paged) and individual release URL pattern. **Workaround for scraper: Chrome UA spoof** (already noted in spec Risk 1).
- **CalSTRS IPS index** (`/investment-policies`) — same 403. Needs browser verification to confirm the link text and PDF anchor pattern.

No other plans hit hard blockers.

---

## Plans with potentially ambiguous IPS document

- **CalSTRS** — search returned 10 PDFs all with "Investment Policy Statement" in the title. The canonical board-approved master IPS appears to be `InvestmentPolicyStatement05-2025.pdf`, but the index page also lists asset-class-specific policies (Real Estate, Private Equity, Global Equity, Fixed Income, Pension2, Infrastructure, ESG). Scraper must target the master IPS only and ignore asset-class sub-policies — but those sub-policies are valuable signal too (could be added as a separate `ips_sub_policy` document type later). **Decision needed:** scope this week to the master IPS only? Recommended yes.
- **Mass PRIM** — search surfaced both `PRIM-IPS-Board-approved-December-5-2024.pdf` (Dec 2024) and `PRIM-Investment-Policy-Statement-02152024.pdf` (Feb 2024). The Dec 2024 version is the most recent and is the canonical IPS. Scraper logic: pick the highest-dated `PRIM-IPS-*.pdf` from `/wp-content/uploads/`. No real ambiguity once date-sort is applied.

---

## Pattern observations across plans

1. **5/5 IPS documents are PDFs.** Zero HTML. Universal across plans.
2. **3/5 IPS URLs are stable** (CalPERS, NYSCRF, Oregon — content overwritten in place; hash check sufficient).
3. **2/5 IPS URLs embed version metadata in the path** (CalSTRS embeds hash + date, Mass PRIM embeds approval date). These need index-crawl logic, not hard-coded URL polling.
4. **5/5 press release feeds use a path that contains "press" or "news" or "newsroom".** No two plans use the same path component:
   - CalPERS: `/newsroom/calpers-news/...`
   - CalSTRS: `/news-releases` then `/{slug}` at root
   - NYSCRF: `/press/releases/{year}/{month}/{slug}`
   - Mass PRIM: `/newsroom/` (singular) with PDFs under `/wp-content/uploads/{year}/{month}/`
   - Oregon: `/oregon-newsroom/OR/OST/Posts/Post/{slug}` on a subdomain
5. **2/5 press feeds are mixed** with non-pension content (NYSCRF mixed with all OSC press, Oregon mixed with all Treasury press). Both have topic/category filters available, so per-plan filter rules are needed.
6. **1/5 plans (CalSTRS) requires UA spoofing** to fetch — matches existing spec Risk 1.
7. **0/5 plans had a JavaScript-only feed** (no client-side rendering blockers visible). All can be scraped with HTTP fetch + Cheerio, except CalSTRS where the body fetches require Chrome UA but the markup is still server-rendered.

---

## Strategy outcome per plan

| Plan | Strategy used |
|---|---|
| CalPERS | 1 (direct fetch of likely URL — verified) |
| CalSTRS | 1 + manual flag (URL identified, fetch blocked) |
| NYSCRF | 2 (followed nav from `/common-retirement-fund` to `/press`) |
| Mass PRIM | 1 (direct fetch verified `/newsroom/` is canonical) |
| Oregon | 2 (search surfaced both candidates; verified `apps.oregon.gov` is the live feed, `oregon.gov/treasury/news-data` is a nav page) |
