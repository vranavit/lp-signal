# Pension Batch Research — 2026-04-22

Research-only scan of 12 US public pensions beyond the two already scraping
(CalPERS, NYSCRF). Goal: decide which ones fit an existing template
(CalPERS-style board minutes, NYSCRF-style monthly PDFs, or
Blackstone-style GP press releases), which need a custom path, and what the
build ROI looks like for each.

No scraper code, migrations, or prompt updates were written. Zero classifier
API cost incurred.

---

## Per-pension findings

### California State Teachers' Retirement System (CalSTRS)

- **Primary disclosure URL:** https://www.calstrs.com/investments (meeting pages at `/{YYYY-MM-DD}-board-meeting-{month}-{year}`); PDFs under `calstrs.com/files/{hash}/INV+{YYYY-MM}+Item+...pdf`
- **Cadence:** Per-meeting (Investment Committee ~6x/year); semi-annual PE Activity Report (period ending Jun 30 / Dec 31)
- **Freshness:** Most recent IC meeting Mar 2026 (~1.5-month lag); semi-annual PE reports lag ~2–3 months behind period end
- **File format:** Digital PDF (selectable text), embedded as agenda items on meeting pages
- **Category A volume:** ~20–40/year (CalSTRS disclosed $4.7B PE/RE commitments in one recent semi-annual report)
- **Template match:** CalPERS-style (near-identical — per-meeting sub-page, agenda item PDFs, semi-annual PE "Executive Summary" with commitment schedules)
- **Gotchas:** WebFetch returned 403 on some pages (anti-bot/CDN) — needs a browser-like UA; PDF slug contains a random hash (`/files/f44076df3/`) so URLs can't be generated — must scrape meeting page for anchors; some closed-session PE materials omitted
- **Build notes:** Near-clone of CalPERS scraper. Index off board-meeting list → per-meeting page → grep anchors matching `INV+YYYY-MM+Item+...PE` or `semi{MMYYYY}P+-+PE.pdf` → download digital PDF → classifier parses commitment tables from semi-annual PE Activity Report.

### Teacher Retirement System of Texas (TRS Texas)

- **Primary disclosure URL:** https://www.trs.texas.gov/about/trustees/board-meeting-materials; IMC books at `trs.texas.gov/sites/default/files/{YYYY-MM}/imc-book-{mon}-{yyyy}.pdf` (recent) or `/TRS%20Documents/imc-book-{mon}-{yyyy}.pdf` (older/migrated)
- **Cadence:** Quarterly Investment Management Committee (Feb, Apr/May, Jul, Sep, Dec) — ~5–6 IMC meetings/year
- **Freshness:** Most recent confirmed IMC book = Dec 2025; Feb 2026 meeting covered in press ($626M committed) but book PDF not yet located — lag 1–4 months
- **File format:** Digital PDF "IMC Books" (100+ pages, selectable text)
- **Category A volume:** ~20–40/year (PE target ~12% of ~$200B AUM; Alternatives Watch reports $329M–$626M/month in private markets deployments)
- **Template match:** Hybrid — per-meeting PDF (CalPERS-style) but stable filename template (`imc-book-{month}-{yyyy}.pdf`), two base paths (`/sites/default/files/YYYY-MM/` vs `/TRS%20Documents/`) depending on migration era
- **Gotchas:** URL base path changed mid-2025 — scraper needs fallback across both; IMC books are large (can exceed 100MB); naming sometimes abbreviates (`sept` vs `september`); commitment schedules often embedded deep in the book
- **Build notes:** Quasi-NYSCRF-style. Try URL generation first (`imc-book-{mon}-{yyyy}.pdf` against both base paths); fall back to scraping the board-meeting-materials index. Parse PE / Private Markets sections from the IMC book.

### Florida State Board of Administration (Florida SBA)

- **Primary disclosure URL:** https://www.sbafla.com/reporting/alternative-asset-status-performance-report/ (quarterly alt-asset report) + https://www.sbafla.com/oversight/investment-advisory-council/ (quarterly IAC meeting materials)
- **Cadence:** Quarterly (IAC meets quarterly; Alt-Asset Status & Performance Report published quarterly with ~1-quarter lag)
- **Freshness:** Most recent IAC materials = Dec 15, 2025 (~4-month lag as of 2026-04-22); Q3 2025 Alt-Asset report is current
- **File format:** Digital PDFs. IAC slide decks at `sbafla.com/media/{random-slug}/combined-{MM-DD-YY}-iac-slides.pdf`; quarterly alt-asset reports at `sbafla.com/media/{slug}/{yyyy}-q{n}-alternative-asset-status-performance-report.pdf`
- **Category A volume:** ~30–60/year (Alts Watch: $2.3B in Q4 2025 alone across PE/RE/HF; Florida SBA ~$245B AUM)
- **Template match:** **Custom** (hybrid CalPERS + NYSCRF) — stable filename pattern BUT the CDN injects a random slug segment (`/media/{random-slug}/`) that defeats URL generation
- **Gotchas:** WebFetch returned 403 on `/reporting/` and `/fsb/investment-committee` (CloudFront/WAF) — scraper needs real browser UA/cookies or headless; random `/media/{slug}/` prefix forces HTML index scrape; commitment data often in IAC slide decks as summarized tables (may need OCR/table extraction even on digital PDFs); annual AIR is the most comprehensive but yearly-only
- **Build notes:** Scrape the reporting index + IAC calendar for anchor hrefs, then download quarterly Alt-Asset report + IAC slide decks. Expect anti-bot friction — likely needs headless browser or sophisticated UA header. Highest absolute volume of the 12 but highest friction.

### Washington State Investment Board (WSIB)

- **Primary disclosure URL:** https://www.sib.wa.gov/meetings.html; PDFs at `sib.wa.gov/docs/meetings/{committee}/{YY}_{MMDD}final.pdf` (or `content.pdf` for upcoming/preliminary)
- **Cadence:** Private Markets Committee ~monthly; Board quarterly + retreats; commitment recommendations appear in PMC first, ratified at Board
- **Freshness:** Latest = Feb 19, 2026 Board and Nov 6, 2025 PMC final. Post-Jun 2025 policy: all open-session materials posted after each meeting; lag 2–6 weeks (minutes require next-meeting approval)
- **File format:** Digital PDF (selectable text, ~1.2 MB typical); committee types: `board`, `admin`, `private`, `public`, `audit`
- **Category A volume:** ~15–25/year PE commitments (Alts Watch: $1.8B across private markets in Apr 2026; $52B PE NAV in $187B program; PMC meets 10–12x/year, 1–3 commitments/meeting)
- **Template match:** **NYSCRF-style** (cleanest) — URL fully generable from meeting date once you know the PMC calendar
- **Gotchas:** Meeting calendar not perfectly periodic (months skipped, occasional mid-month 2nd meeting) — must fetch `meetings.html` for actual dates; recent meetings post as `content.pdf` first, rename to `final.pdf` once approved — scraper must try both; pre-Jun 2025 meetings may have no public PDFs
- **Build notes:** Easiest of all 12. Fetch `meetings.html` → construct `/docs/meetings/{type}/{YY}_{MMDD}{final|content}.pdf` per listed meeting → download → classifier extracts `"Private Equity Investment Recommendation: {Fund}, L.P."` sections. Could run weekly.

### Oregon Public Employees Retirement Fund (Oregon PERS / OIC)

- **Primary disclosure URL:** https://www.oregon.gov/treasury/invested-for-oregon/pages/oregon-investment-council.aspx (meetings) + https://www.oregon.gov/treasury/invested-for-oregon/pages/performance-holdings.aspx (quarterly holdings)
- **Cadence:** Per-meeting (~8/year: Jan, Mar, Apr, May, Jul, Sep, Oct, Dec); plus quarterly PE portfolio PDF
- **Freshness:** Excellent — Apr 15, 2026 meeting scheduled; Mar 4, 2026 minutes already published. Quarterly PE holdings through Q3 2024 on holdings page (Q4/2025 likely posted)
- **File format:** Digital PDFs. Meeting "Public Book" + separate "Meeting Minutes" PDF per date. Quarterly `OPERF_Private_Equity_Portfolio_-_Quarter_N_YYYY.pdf` is tabular digital PDF
- **Category A volume:** ~15–25/year named GP commitments (OIC targets $2.5B PE commitments for 2026; minutes embed commitments like "Sixth Street Specialty Lending Europe III, $165M")
- **Template match:** Hybrid NYSCRF-style (URLs generative by date, no index scrape) + CalPERS-style extraction (commitments embedded in minutes prose + quarterly holdings table)
- **Gotchas:** Filename date format inconsistent across folders — `MM.DD.YY-OIC-PUBLIC-Book.pdf` vs `OIC-Meeting-Minutes-M.D.YY.pdf` vs `M-D-YYYY-Meeting-Minutes-final.pdf` historically. OIC Meeting Archive index page is stale (last updated 2020) — do NOT rely on it. Minutes typically posted 1–2 meetings after event
- **Build notes:** Two-track scraper: (1) NYSCRF-style URL generator keyed off the published meeting calendar for public books + minutes; (2) quarterly holdings PDF with fixed `OPERF_Private_Equity_Portfolio_-_Quarter_{1..4}_{YYYY}.pdf` pattern — rolling schedule of every active GP fund. Parse tabular holdings for ground-truth portfolio; parse minutes prose for fresh commitments between quarters.

### Ohio Public Employees Retirement System (OPERS)

- **Primary disclosure URL:** https://www.opers.org/about/board/meetings/ (board materials) + https://www.opers.org/pubs-archive/financial/2024-OPERS-Annual-Report.pdf (ACFR schedule of investments)
- **Cadence:** Board meets monthly (~10/year, skip Apr/Jun/Dec). ACFR annual. Annual Investment Plan once a year
- **Freshness:** **Weak** for per-meeting disclosure — meetings page lists dates but no direct agenda/minutes links in static HTML. ACFR is 9–12 months lagged (2024 ACFR is latest as of Apr 2026)
- **File format:** ACFR and Annual Investment Plan are digital PDFs. Per-meeting agendas/minutes appear to be posted but URLs aren't linearly exposed in the meetings index (likely JS-rendered or transient)
- **Category A volume:** ~5–10/year named GP commitments publicly (e.g., Francisco Partners VI $250M via trade press). OPERS does NOT publish a monthly transaction report; named-GP list is only in the annual ACFR
- **Template match:** **Custom / weak CalPERS-style**. Not NYSCRF-style (no predictable monthly URL). Partial Blackstone-press-release-style workaround — trade press (PEI, Buyouts) often names OPERS commitments before OPERS itself confirms
- **Gotchas:** Meetings index renders no PDF links in static HTML — needs headless browser or URL enumeration by guess; approved minutes delayed a full month; GP-level disclosure is essentially annual not per-meeting
- **Build notes:** Primary pipeline should be the annual ACFR PDF (parse schedule of investments once/year for the authoritative GP list). Secondary: a GP-side (Blackstone-style) press-release watcher naming "OPERS committed $X to [fund]" to fill the intra-year gap. Attempt a headless-browser pass on `/about/board/meetings/` only if per-meeting coverage is essential — budget for instability.

### Pennsylvania Public School Employees Retirement System (PA PSERS)

- **Primary disclosure URL:** https://www.pa.gov/agencies/psers/newsroom/ (board meeting posts) + https://www.pa.gov/agencies/psers/board-of-trustees/board-resolutions/2026-board-meeting-resolutions
- **Cadence:** ~6 board meetings/year (roughly every 2 months). Each meeting gets a newsroom post listing approved commitments
- **Freshness:** Excellent — Mar 19, 2026 post already at `/newsroom/03192026`. Typically posted within 1–3 days of the meeting
- **File format:** HTML article with named GP fund commitments inline in prose ("$150M to DRA Growth and Income Fund, $200M to LS Power Equity Partners IV, $75M to Warwick V LP"). Each fund name often links to a PDF board resolution under `/content/dam/.../resolutions/{YYYY}/`
- **Category A volume:** ~15–25/year named GP commitments across PE, RE, credit, infra (Mar 2026 = 3, Dec 2025 = 4, Oct 2025 = 1, Aug 2025 = 2)
- **Template match:** Hybrid — URL slug `/newsroom/MMDDYYYY` is NYSCRF-style generative once meeting dates are known; content extraction is CalPERS-style (named commitments in prose) but on HTML not PDF
- **Gotchas:** Slug format drifts — newer posts use `/newsroom/MMDDYYYY`, older ones use descriptive slugs like `/psers-board-announces-investment-actions-and-results`; some end in `.html`; newsroom index search returned "no results" in WebFetch (JS-rendered), so derive URLs from the meeting calendar
- **Build notes:** Generate URL from board-meeting date → fetch HTML → regex or LLM-extract "$X million to [fund name]" phrases. Mirror to PDF resolution if linked. Fall back through `/newsroom/MMDDYYYY` → `/newsroom/MMDDYYYY.html` → descriptive-slug search. Because content is HTML not PDF, classifier can take extracted text — no PDF round-trip needed.

### New York State Teachers' Retirement System (NYSTRS)

- **Primary disclosure URL:** https://www.nystrs.org/getmedia/9faf83c9-e0da-4e86-b436-c0ce2bc272ee/PE_Commitments.pdf (rolling PE commitments log) + board meeting minutes at `nystrs.org/getmedia/{GUID}/BoardMinutes_{M-D-YY}.pdf`
- **Cadence:** Board meets quarterly (Jan, Apr, Jul, Oct). PE_Commitments.pdf appears to be a continuously-updated rolling document (same URL, updated with each new commitment — Aug 2025 and Sep 2025 entries visible)
- **Freshness:** Good — latest minutes Oct 30, 2025; Jan 2026 minutes likely posted. PE_Commitments.pdf has Sep/Oct 2025 entries already
- **File format:** Digital PDFs. Minutes multi-page prose. PE_Commitments.pdf is a structured log of "commitment up to $X to [Fund], approved [date], closed [date]"
- **Category A volume:** ~10–20/year named GP commitments (historical: $430M in one Jan 2024 cycle; recent press shows $350M in a single period)
- **Template match:** **Custom** — neither CalPERS-style meeting index nor NYSCRF-style URL generation. Stable single-URL living document (best-case target) + quarterly board minutes supplement
- **Gotchas:** URLs use opaque GUIDs (`/getmedia/{uuid}/{filename}.pdf`) — filename guessable, GUID not — so cannot generate URLs for new minutes, must discover via Board Meetings index, which returned HTTP 403 (bot-blocked or JS-rendered). PE_Commitments.pdf is a single stable URL but needs confirmation it's canonical vs. a one-off. Filename format drifts (`BoardMinutes_10-30-2025.pdf` vs `BoardMinutes_4-26-23.pdf`)
- **Build notes:** Primary target = stable `PE_Commitments.pdf` URL. Poll monthly, diff against prior snapshot, new rows = new commitments. Cleanest of all NYSTRS paths. Secondary: site-search (`site:nystrs.org BoardMinutes`) to discover new GUID-suffixed minutes URLs since direct index is bot-blocked. Consider headless fallback if site-search coverage is thin.

### Illinois Teachers Retirement System (TRS Illinois)

- **Primary disclosure URL:** https://www.trsil.org/trustees/minutes (Investment Committee PDFs at `https://www.trsil.org/sites/default/files/documents/{YYYY-MM-DD}...Minutes...Investment Committee...FINAL.pdf`)
- **Cadence:** Per-meeting — IC ~6x/year (Feb, Apr/Jun, Jul, Oct, Dec); Board meets same months
- **Freshness:** Most recent is Dec 18, 2025 IC minutes (~4-month lag; next meeting likely Feb 2026 posted soon)
- **File format:** Digital PDF, prose-style minutes with commitment actions embedded (e.g. "$150M to Vista Equity Partners", "$200M to Pretium Partners")
- **Category A volume:** ~15–25/year (confirmed via news: $810M PE round, $1.5B+ round, etc.)
- **Template match:** CalPERS-style
- **Gotchas:** Filename casing/spacing inconsistent (URL-encoded spaces `%20` vs no-space like `2025-10-23MinutesoftheInvestmentCommitteeFINAL_0.pdf`); occasional `_0` suffix; commitments in prose not a DOA table; DRAFT vs FINAL versions (filename may change)
- **Build notes:** CalPERS-style clone. Crawl `/trustees/minutes/{YYYY}` index pages → extract IC PDF links → download → LLM-extract commitments from prose. Filename not strictly generatable — must discover via HTML parse of year index.

### Michigan Retirement Systems (SMRS / Bureau of Investments)

- **Primary disclosure URL:** https://www.michigan.gov/treasury/about/investments/quarterly; PDFs at `https://www.michigan.gov/treasury/-/media/Project/Websites/treasury/SMIB/{YYYY}/{Month}-{YYYY}-SMIB-Report.pdf` (also a `SMIB-Report-{MDYYYY}.pdf` variant)
- **Cadence:** Quarterly — SMIB meets ~4x/year (Jan, Apr, Jun, Oct, Dec observed)
- **Freshness:** Excellent — `SMIB-Report-3252026.pdf` (Mar 25, 2026 meeting) found in search, ~1-month lag
- **File format:** Digital PDF, exec-summary prose + tables; lists individual commitments by fund name ("Advent International GPE XI $50M", "TPG Healthcare Partners III $50M", "Khosla Ventures IX $50M")
- **Category A volume:** ~20–40/year (quarterly totals $350M–$1.6B across 5–15 funds each)
- **Template match:** **NYSCRF-style** (predictable URL, quarterly PDF, section-headed)
- **Gotchas:** Two filename variants (`{Month}-{YYYY}-SMIB-Report.pdf` vs `SMIB-Report-{MDYYYY}.pdf` with `?rev=...` query strings); michigan.gov returns 403 to some automated fetchers — need UA spoofing; separate `-Attachments.pdf` and `-Presentation.pdf` companion files per meeting
- **Build notes:** Generate candidate URLs by iterating months/quarters; probe both filename variants. Alternatively scrape the quarterly index page for authoritative links. Digital PDFs parse cleanly — extract "new commitments" section table.

### Massachusetts PRIM (MassPRIM)

- **Primary disclosure URL:** https://www.mapension.com/records-of-interest/; IC meeting PDFs at `https://www.mapension.com/wp-content/uploads/{YYYY}/{MM}/...Investment-Committee-{MMDDYYYY}.pdf` (expanded agenda + appendices per meeting); Board materials likewise under `/wp-content/uploads/`
- **Cadence:** Quarterly IC meetings (Feb, May, Aug, Nov); monthly Performance Summaries; Board monthly/quarterly
- **Freshness:** Monthly performance through Feb 2026 (~1–2 month lag); most recent IC minutes Aug 5, 2025 (~8-month lag — minutes posted after next approval cycle); Feb 10, 2026 IC materials likely posted near meeting date
- **File format:** Digital PDF; large packets (agenda + appendices with tables). IC agendas routinely contain "New Investment Recommendation" memos naming GP fund, amount, strategy
- **Category A volume:** ~20–35/year (PE plan $2–3B/year across ~15–25 funds; plus RE, credit, hedge)
- **Template match:** CalPERS-style (per-meeting PDF discovery), hybrid with predictable URL structure once meeting exists
- **Gotchas:** `wp-content/uploads/{YYYY}/{MM}/` folder uses *upload* year/month, not meeting date — a 11/12/2024 meeting PDF can live under `/2023/12/`. Filename conventions drift (hyphens, capitalization). Board and IC materials interleaved — need to filter by title. Individual commitment memos sometimes only in appendix attachments, not in summary minutes
- **Build notes:** Scrape `/records-of-interest/` and `/events/` pages for canonical URLs; don't try to generate. Per-meeting PDF is large (200–400 pages) — needs chunking before LLM extraction.

### North Carolina Retirement Systems (NCIA / formerly NC Treasurer IMD)

- **Primary disclosure URL:** https://www.ncinvest.gov/reports (monthly) + https://www.ncinvest.gov/nc-investment-authority-board (quarterly meetings) + legacy archive https://www.nctreasurer.gov/divisions/nc-investment-authority/quarterly-investment-reports-archive
- **Cadence:** Monthly reports (`/ncia/ncia-{MM}-{YYYY}-monthly-report/open`); quarterly NCIA Board meetings (2/25, 5/27, 8/28, 11/18/2026); quarterly Investment Reports under G.S. 147-68; annual Performance and Fee Report
- **Freshness:** Monthly report through Feb 2026 (~1–2 month lag); quarterly QIR most recent Q3 2025 (~6-month lag); annual Performance and Fee Report FY 2024-2025
- **File format:** Digital PDF (WebFetch returned binary but extractable); monthly reports likely performance/allocation dashboards; quarterly QIRs contain individual fund holdings; annual Performance and Fee Report confirmed to list fund-by-fund (Blackstone RE Partners IV–VIII named)
- **Category A volume:** ~15–30/year (recent news: $725M Ares PE, $500M Ares RE, etc.)
- **Template match:** Hybrid — NYSCRF-style for monthly URL pattern, CalPERS-style for quarterly board meeting materials
- **Gotchas:** **Organizational transition 2026-01-01** — NCIA took over from Treasurer's IMD under the 2025 State Investment Modernization Act. Old URLs on nctreasurer.gov, new on ncinvest.gov — must monitor both domains. Legacy quarterly archive URL pattern inconsistent across years (`/imdiac/`, `/imdinvestmentreports/`, `/annualinvestmentreportsarchives/`). Individual commitments appear in quarterly/annual reports, not necessarily monthlies (may be aggregate performance only — unconfirmed due to PDF binary response)
- **Build notes:** Generate monthly URLs on ncinvest.gov pattern; supplement with quarterly QIR scrape from archive page; separately scrape NCIA Board Archives page. Validate with one decoded PDF before building — if monthlies are aggregate-only, the authoritative Category A source is the annual Performance and Fee Report + quarterly QIRs, which collapses this to a quarterly cadence.

---

## Ranked ROI table — Category A signal yield per hour of build

| Rank | Pension | Template | Build hrs | Cat A / yr (mid) | Yield / hr | Notes |
|---|---|---|---|---|---|---|
| 1 | **WSIB** | NYSCRF-style | 2 | 20 | **10.0** | Cleanest URL pattern of all 12; single `meetings.html` index scrape |
| 2 | **Michigan SMRS** | NYSCRF-style | 2.5 | 30 | **12.0** | Quarterly PDF, stable pattern, UA spoofing handles 403 |
| 3 | **PA PSERS** | Hybrid (HTML gen) | 2.5 | 20 | **8.0** | HTML newsroom posts, no PDFs to parse; slug drift is only friction |
| 4 | **NYSTRS** | Custom (stable URL) | 2 | 15 | **7.5** | If PE_Commitments.pdf is canonical, poll + diff is trivial |
| 5 | **CalSTRS** | CalPERS-style | 3.5 | 30 | **8.6** | Near-clone of existing CalPERS scraper; UA tweak needed |
| 6 | **TRS Texas** | Hybrid | 3.5 | 30 | **8.6** | Two base paths to probe + large books |
| 7 | **Florida SBA** | Custom | 5 | 45 | **9.0** | Highest absolute yield but anti-bot 403 + random CDN slugs |
| 8 | **MassPRIM** | CalPERS-style | 3.5 | 27 | **7.7** | Per-meeting packets, need chunking; upload-date folder quirk |
| 9 | **TRS Illinois** | CalPERS-style | 3.5 | 20 | **5.7** | Filename drift + DRAFT→FINAL rename |
| 10 | **Oregon PERS** | Hybrid | 4 | 20 | **5.0** | Two-track (meetings + holdings); filename format drifts |
| 11 | **NC Retirement** | Hybrid | 5 | 22 | **4.4** | Org transition — two domains to monitor; monthly granularity unconfirmed |
| 12 | **OPERS** | Custom / annual | 7 | 8 | **1.1** | Per-meeting disclosure effectively doesn't exist; ACFR is annual-only |

Assumptions: build hours = from-scratch with the existing Node/cheerio stack, no headless browser; yield uses the midpoint of each pension's estimated Category A range. Real build times will vary ±30%.

---

## Honest assessment — build now, defer, or skip

### Build this month (Tier 1) — 4 pensions, ~9 hours total
**WSIB, Michigan SMRS, PA PSERS, NYSTRS.**
These four share one property: URLs are either fully generative or cluster around a single stable endpoint. All four can be built by adapting the existing NYSCRF scraper shell with minor variations. Combined, they deliver an estimated **~85 Category A signals/year** for ~9 hours of engineering. That's ~9.4 signals/hour, roughly matching the existing NYSCRF yield. PA PSERS is the outlier of the group — it's HTML-only (no PDF round-trip) which may actually need a separate text-input classifier path, but the prose extraction problem is well-scoped.

### Build next (Tier 2) — 4 pensions, ~14 hours total
**CalSTRS, TRS Texas, MassPRIM, TRS Illinois.**
All fit the existing CalPERS scraper pattern (meeting index → per-meeting sub-page → PDF anchors). Combined yield estimate: ~110 signals/year. Slightly worse yield-per-hour than Tier 1 but uses the exact same code pattern already validated with CalPERS. Worth building after the Tier 1 wins land because each requires per-pension filename/slug tweaks rather than new infrastructure.

### Defer until needed (Tier 3) — 3 pensions
**Florida SBA, Oregon PERS, NC Retirement.** Florida SBA has the highest absolute yield of any pension researched (30–60/year) and would be tempting — but the CloudFront/WAF 403s likely force a headless browser (Playwright), which is a new dependency with its own maintenance overhead. Build only when the product demand justifies adding Playwright to the stack, then batch Florida SBA with any other JS-rendered sources. Oregon PERS is a legitimate double-source (minutes + quarterly holdings) that is worth the extra build time when the existing Tier 1/2 backlog is cleared. NC Retirement is in a mid-organizational-transition (NCIA took over 2026-01-01) — wait 2–3 months for URL patterns to settle before committing engineering time.

### Skip for now — 1 pension
**OPERS.** Per-meeting disclosure of named GP commitments essentially does not exist on their site (static HTML shows no PDF links, suggesting JS-rendered or intentionally un-indexed). The only authoritative GP-level source is the annual ACFR, which runs 9–12 months behind — worse than useless for live signal feeds. The realistic coverage path for OPERS is the GP-side Blackstone-style press-release watcher already in the scraper set, which will naturally pick up "OPERS committed $X to [fund]" announcements without a dedicated OPERS scraper. Revisit only if OPERS changes disclosure policy.

### Cross-cutting observations
1. **Anti-bot friction is the #1 build cost driver**, not content extraction. CalSTRS, Florida SBA, Michigan SMRS, NYSTRS all returned 403s to plain `fetch()`. Standardizing on a realistic `User-Agent` + optional cookie handling in the shared scraper utilities would unblock four of the 12 at once.
2. **Three distinct structural patterns cover 11 of 12 pensions:** NYSCRF-style (stable URL gen), CalPERS-style (meeting index → PDF discovery), and newsroom/HTML-style (PSERS-only so far). Investing in a shared meeting-index helper and a shared URL-generator helper makes most remaining pensions a 2-hour build instead of 4.
3. **The `v2.3` mortgage + public-equity rejection rules in the classifier prompt are likely reusable as-is** for every pension except Florida SBA (whose Alt-Asset reports may surface hedge funds outside the current PE/Infra/Credit/RE/VC enum — watch for enum leakage).
4. **Blackstone-style GP press-release coverage should be treated as a true safety net**, not a replacement. For OPERS and potentially NC Retirement's intra-year gap, it's the only practical intra-year signal — but it doesn't scale to all 12 pensions without per-GP-firm setup.
