-- Day 10 Session 2: seed Oregon PERS (Oregon Investment Council).
--
-- The Oregon Investment Council manages Oregon PERS assets via the
-- Oregon State Treasury. Board-meeting PDFs are linked directly off the
-- OIC meeting index page with a predictable URL structure under
-- /treasury/invested-for-oregon/Documents/Invested-for-OR-47OIC-Agenda-
-- and-Minutes/YYYY/.
--
-- Scraper: lib/scrapers/oregon.ts.
-- AUM figure is approximate and will be overwritten on the next CAFR
-- ingest.

insert into public.plans (
  name, country, aum_usd, tier, active,
  scrape_method, scrape_url, scrape_config
)
values (
  'Oregon PERS',
  'US',
  100000000000,
  1,
  true,
  'board_minutes',
  'https://www.oregon.gov/treasury/invested-for-oregon/pages/oregon-investment-council.aspx',
  jsonb_build_object(
    'key', 'oregon_pers',
    'website', 'https://www.oregon.gov/pers'
  )
)
on conflict do nothing;
