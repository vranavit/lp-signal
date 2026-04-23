-- Day 10 Session 2: seed Massachusetts PRIM.
--
-- Pension Reserves Investment Management Board — manages the PRIT Fund
-- for Massachusetts public pensions. Board-meeting PDFs are published to
-- wp-content/uploads/YYYY/MM/ on a 1-3 month lag from the meeting date;
-- the scraper probes candidate URLs against a published meeting calendar.
--
-- Scraper: lib/scrapers/ma-prim.ts.

insert into public.plans (
  name, country, aum_usd, tier, active,
  scrape_method, scrape_url, scrape_config
)
values (
  'Massachusetts PRIM',
  'US',
  109000000000,
  1,
  true,
  'board_minutes',
  'https://www.mapension.com/events/',
  jsonb_build_object(
    'key', 'ma_prim',
    'website', 'https://www.mapension.com'
  )
)
on conflict do nothing;
