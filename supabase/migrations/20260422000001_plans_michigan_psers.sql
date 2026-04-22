-- Add Michigan SMRS and PA PSERS to the plans table.
-- Idempotent via on conflict (name, country) do update — matches the pattern
-- used by the initial seed migration.

insert into public.plans (name, country, aum_usd, tier, scrape_method, scrape_url, scrape_config) values
  ('Michigan SMRS', 'US', 100000000000, 1, 'board_minutes',
     'https://www.michigan.gov/treasury/about/investments/quarterly',
     jsonb_build_object('key', 'michigan')),
  ('PA PSERS',      'US', 80000000000,  1, 'board_minutes',
     'https://www.pa.gov/agencies/psers/newsroom',
     jsonb_build_object('key', 'pa_psers'))
on conflict (name, country) do update set
  aum_usd       = excluded.aum_usd,
  tier          = excluded.tier,
  scrape_method = excluded.scrape_method,
  scrape_url    = excluded.scrape_url,
  scrape_config = excluded.scrape_config;
