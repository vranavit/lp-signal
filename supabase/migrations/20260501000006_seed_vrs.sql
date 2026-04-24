-- Day 10 Session 3: seed Virginia Retirement System (VRS).
--
-- VRS manages pension assets for Virginia state and local employees,
-- teachers, and judges (the Trust Fund, plus defined-contribution plans).
-- The Board of Trustees + Investment Advisory Committee publish meeting
-- agendas, packets, and approved minutes to
-- /media/members/pdf/board/{agendas,materials,minutes}/YYYY/ under
-- predictable filenames keyed on meeting date.
--
-- Scraper: lib/scrapers/vrs.ts.
-- AUM figure is approximate (FY2025 total fund ~$114B) and will be
-- overwritten on the next CAFR ingest.

insert into public.plans (
  name, country, aum_usd, tier, active,
  scrape_method, scrape_url, scrape_config
)
values (
  'Virginia Retirement System',
  'US',
  114000000000,
  1,
  true,
  'board_minutes',
  'https://www.varetire.org/about/board/meetings/',
  jsonb_build_object(
    'key', 'vrs',
    'website', 'https://www.varetire.org'
  )
)
on conflict do nothing;
