-- Day 10 Task C+ Component 1: seed Minnesota State Board of Investment (SBI).
--
-- MSBI manages assets for Minnesota public employees (~$150B AUM across
-- combined funds for the state retirement systems, supplemental
-- investment fund, and mutual funds). The Board meets quarterly
-- (Feb/May/Aug/Dec) and publishes packets, minutes, and approvals
-- summaries to /sites/default/files/YYYY-MM/*.pdf under three decades of
-- drifting naming conventions — the scraper parses all observed variants
-- and falls back to the YYYY-MM path segment for ordering.
--
-- Scraper: lib/scrapers/minnesota-sbi.ts.
-- AUM figure is approximate (FY2025 Combined Funds ~$150B) and will be
-- overwritten on the next CAFR ingest.

insert into public.plans (
  name, country, aum_usd, tier, active,
  scrape_method, scrape_url, scrape_config
)
values (
  'Minnesota State Board of Investment',
  'US',
  150000000000,
  1,
  true,
  'board_minutes',
  'https://www.msbi.us/board-meetings',
  jsonb_build_object(
    'key', 'minnesota_sbi',
    'website', 'https://www.msbi.us'
  )
)
on conflict do nothing;
