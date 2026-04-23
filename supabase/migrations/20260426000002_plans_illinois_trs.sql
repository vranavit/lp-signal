-- Day 6: seed Illinois TRS (Teachers Retirement System). Not previously
-- seeded; adds a new plan row so CAFR ingestion has a target.
-- Idempotent via on conflict do update.

insert into public.plans (name, country, aum_usd, tier, scrape_method, scrape_url, scrape_config) values
  ('TRS Illinois', 'US', 70000000000, 1, 'annual_report',
     'https://www.trsil.org',
     jsonb_build_object('key', 'trs_illinois'))
on conflict (name, country) do update set
  aum_usd       = excluded.aum_usd,
  tier          = excluded.tier,
  scrape_method = excluded.scrape_method,
  scrape_url    = excluded.scrape_url,
  scrape_config = excluded.scrape_config;
