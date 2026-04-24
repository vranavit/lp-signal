-- Day 10 Session 3: seed NJ Division of Investment (State Investment Council).
--
-- The NJ Division of Investment manages the NJ Pension Fund (~$100B AUM
-- across TPAF, PERS, PFRS, SPRS, JRS, plus the Cash Management Fund).
-- The State Investment Council ratifies commitment decisions in monthly
-- meetings and publishes approved minutes to
-- /treasury/doinvest/pdf/ApprovedMinutes/YYYY/ with a mix of naming
-- conventions spanning 2008–present.
--
-- Scraper: lib/scrapers/nj-doi.ts.
-- AUM figure is approximate (latest disclosed fund size ~$100B) and will
-- be overwritten on the next CAFR ingest.

insert into public.plans (
  name, country, aum_usd, tier, active,
  scrape_method, scrape_url, scrape_config
)
values (
  'New Jersey Division of Investment',
  'US',
  100000000000,
  1,
  true,
  'board_minutes',
  'https://www.nj.gov/treasury/doinvest/approvedminutes.shtml',
  jsonb_build_object(
    'key', 'nj_doi',
    'website', 'https://www.nj.gov/treasury/doinvest/'
  )
)
on conflict do nothing;
