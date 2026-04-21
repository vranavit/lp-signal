-- Seed data for LP Signal
-- ─────────────────────────────────────────────────────────────────────────────
-- Idempotent via on conflict so the migration is safe to re-run.

-- ── Allowlist ───────────────────────────────────────────────────────────────
insert into public.allowed_emails (email, note) values
  ('vitek.vrana@bloorcapital.com', 'owner / primary'),
  ('vitek.vrana@mail.utoronto.ca', 'owner / secondary')
on conflict (email) do nothing;

-- ── Plans (top 10 Tier-1 US plans by AUM) ───────────────────────────────────
-- AUM figures are approximate (as of ~2024–2025) and will be kept current later.
insert into public.plans (name, country, aum_usd, tier, scrape_method, scrape_url, scrape_config) values
  ('CalPERS',                          'US', 500000000000, 1, 'board_minutes',
     'https://www.calpers.ca.gov/about/board/board-meetings',
     jsonb_build_object('key', 'calpers')),
  ('CalSTRS',                          'US', 340000000000, 1, 'board_minutes',
     'https://www.calstrs.com/board-meetings', jsonb_build_object('key', 'calstrs')),
  ('New York State Common Retirement Fund', 'US', 270000000000, 1, 'board_minutes',
     'https://www.osc.ny.gov/common-retirement-fund', jsonb_build_object('key', 'nyscrf')),
  ('Florida SBA',                      'US', 240000000000, 1, 'board_minutes',
     'https://www.sbafla.com/fsb/', jsonb_build_object('key', 'fsba')),
  ('Teacher Retirement System of Texas', 'US', 200000000000, 1, 'board_minutes',
     'https://www.trs.texas.gov/Pages/about_board_meetings.aspx', jsonb_build_object('key', 'trs_texas')),
  ('Washington State Investment Board', 'US', 180000000000, 1, 'board_minutes',
     'https://www.sib.wa.gov/board/meetings.asp', jsonb_build_object('key', 'wsib')),
  ('NYSTRS',                           'US', 140000000000, 1, 'board_minutes',
     'https://www.nystrs.org/About-Us/Board-Retirement-Board-Meetings', jsonb_build_object('key', 'nystrs')),
  ('Wisconsin SWIB',                   'US', 160000000000, 1, 'board_minutes',
     'https://www.swib.state.wi.us/board-of-trustees', jsonb_build_object('key', 'swib')),
  ('North Carolina Retirement Systems', 'US', 120000000000, 1, 'board_minutes',
     'https://www.nctreasurer.com/divisions/retirement', jsonb_build_object('key', 'nc_retirement')),
  ('Ohio PERS',                        'US', 110000000000, 1, 'board_minutes',
     'https://www.opers.org/about/board/', jsonb_build_object('key', 'ohio_pers'))
on conflict (name, country) do update set
  aum_usd       = excluded.aum_usd,
  tier          = excluded.tier,
  scrape_method = excluded.scrape_method,
  scrape_url    = excluded.scrape_url,
  scrape_config = excluded.scrape_config;

-- ── Sample signals (illustrative; seed_data=true so Phase 2 can wipe them) ──
-- These reflect real patterns of CalPERS private markets activity and are used
-- solely to populate the dashboard end-to-end before the classifier is live.
-- They will be deleted as part of the Phase 2 cutover.
do $$
declare
  v_calpers_id uuid;
begin
  select id into v_calpers_id from public.plans where name = 'CalPERS' and country = 'US';
  if v_calpers_id is null then
    raise exception 'seed failed: CalPERS plan row not found';
  end if;

  -- Remove any prior seed rows so this migration is idempotent.
  delete from public.signals where seed_data = true and plan_id = v_calpers_id;

  -- Type 1 — Commitment Announcement
  insert into public.signals (
    plan_id, signal_type, confidence, priority_score, asset_class,
    summary, fields, source_page, source_quote, commitment_amount_usd, seed_data
  ) values (
    v_calpers_id, 1, 0.95, 88, 'Infra',
    'CalPERS approved a $500M commitment to Blackstone Infrastructure Partners IV.',
    jsonb_build_object(
      'gp_name', 'Blackstone',
      'fund_name', 'Blackstone Infrastructure Partners IV',
      'approval_date', '2026-03-19'
    ),
    14,
    'The Investment Committee approved a commitment of up to $500 million to Blackstone Infrastructure Partners IV.',
    500000000,
    true
  );

  -- Type 2 — Target Allocation Change
  insert into public.signals (
    plan_id, signal_type, confidence, priority_score, asset_class,
    summary, fields, source_page, source_quote, commitment_amount_usd, seed_data
  ) values (
    v_calpers_id, 2, 0.92, 72, 'PE',
    'CalPERS raised its private equity target allocation from 13% to 17%, to be phased over 24 months.',
    jsonb_build_object(
      'old_target_pct', 13,
      'new_target_pct', 17,
      'implementation_months', 24,
      'implied_delta_usd', 20000000000
    ),
    8,
    'The Board adopted a revised policy asset allocation increasing the private equity target from 13% to 17%.',
    null,
    true
  );

  -- Type 3 — Pacing Plan Change
  insert into public.signals (
    plan_id, signal_type, confidence, priority_score, asset_class,
    summary, fields, source_page, source_quote, commitment_amount_usd, seed_data
  ) values (
    v_calpers_id, 3, 0.87, 46, 'PE',
    'CalPERS 2026 private equity pacing increased to $14B (from $12B in 2025).',
    jsonb_build_object(
      'prior_year_pacing_usd', 12000000000,
      'new_year_pacing_usd', 14000000000,
      'pct_change', 16.7,
      'fiscal_year', 2026
    ),
    22,
    'Staff presented the 2026 private equity pacing plan of $14 billion, up from $12 billion in the prior year.',
    null,
    true
  );
end;
$$;
