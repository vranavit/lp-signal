-- Day 10 Session 3: seed LACERA (Los Angeles County Employees Retirement Association).
--
-- LACERA manages pension assets for LA County public employees (~$84B
-- AUM). The Board of Investments meets the 2nd Wednesday of each month
-- and publishes agendas and minutes to
-- /sites/default/files/assets/documents/board/YYYY/BOI/
-- YYYY-MM-DD-boi_{agnd,min}.pdf. The index pages surface only the
-- current-year files; older years are reachable at their canonical URL
-- but hidden behind a JS-filtered Drupal view, so the scraper combines
-- index harvesting with a date-candidate probe over the last N months.
--
-- Scraper: lib/scrapers/lacera.ts.
-- AUM figure is approximate (FY2024 Market Value ~$84B) and will be
-- overwritten on the next CAFR ingest.

insert into public.plans (
  name, country, aum_usd, tier, active,
  scrape_method, scrape_url, scrape_config
)
values (
  'LACERA',
  'US',
  84000000000,
  1,
  true,
  'board_minutes',
  'https://www.lacera.gov/leadership/board-meeting',
  jsonb_build_object(
    'key', 'lacera',
    'website', 'https://www.lacera.gov'
  )
)
on conflict do nothing;
