-- Day 10 Task C+ Component 2: seed Colorado PERA (~$64B AUM).
--
-- Colorado PERA publishes ACFRs (fiscal year = calendar year Dec 31) to
-- content.copera.org/wp-content/uploads/YYYY/MM/*.pdf. Board meeting
-- minutes are NOT public — the Board of Trustees page lists only
-- governance documents (investment policy, trustee statements, standing
-- committee assignments). Ingestion is CAFR-only; no board-minutes
-- scraper exists and no wave-2 binding is created.
--
-- Size blocker: the FY2024 ACFR is 84 MB, exceeding Anthropic's 32 MB
-- base64 request ceiling (see classifier comment at lib/classifier/
-- index.ts). The FY2022 ACFR (7.1 MB) is the largest that fits the
-- current ingestion path — scripts/scrape-cafr-colorado-pera.ts targets
-- it as the first allocation snapshot. When the classifier migrates to
-- the Anthropic Files API, swap to the FY2024 ACFR URL.

insert into public.plans (
  name, country, aum_usd, tier, active,
  scrape_method, scrape_url, scrape_config
)
values (
  'Colorado PERA',
  'US',
  64000000000,
  1,
  true,
  'cafr',
  'https://content.copera.org/wp-content/uploads/2025/06/Annual-Comprehensive-Financial-Report.pdf',
  jsonb_build_object(
    'key', 'colorado_pera',
    'website', 'https://www.copera.org'
  )
)
on conflict do nothing;
