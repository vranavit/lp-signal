-- Phase 3 — GP-side press releases.
-- CalPERS DOA reports disclose commitments ~6 months late. GP press releases
-- ("final close", "commitments from") name LPs within days of approval and
-- are the freshness layer of the product.
--
-- Schema changes:
--   1. New `gps` table — entity rows for Blackstone/KKR/Apollo and beyond.
--   2. `documents.plan_id` → nullable. A GP press release isn't owned by any
--      single pension; it may generate signals for multiple pensions that it
--      names. Signals still link back to a plan_id.
--   3. `documents.gp_id` → new nullable FK. Exactly one of {plan_id, gp_id}
--      should be non-null per row (enforced in application code, not DB, to
--      keep the migration simple).
--   4. `documents.content_text` → new nullable text column. Board PDFs still
--      live in Storage; press-release HTML is extracted to plain text and
--      stored inline so the classifier can read it without a second fetch.
--   5. `document_type` check constraint gets a new enum value
--      `'gp_press_release'`.
--   6. Seed 3 GPs (Blackstone, KKR, Apollo) with placeholder press-release
--      index URLs. Update these if the live pages move.

-- 1. gps table
create table if not exists public.gps (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  homepage_url         text,
  press_releases_url   text,
  active               boolean not null default true,
  created_at           timestamptz not null default now()
);

create unique index if not exists gps_name_idx on public.gps (lower(name));

-- 2. documents.plan_id nullable
alter table public.documents
  alter column plan_id drop not null;

-- 3. documents.gp_id FK
alter table public.documents
  add column if not exists gp_id uuid references public.gps(id) on delete cascade;

create index if not exists documents_gp_idx
  on public.documents (gp_id, published_at desc)
  where gp_id is not null;

-- 4. documents.content_text (for HTML-derived text; null for PDF docs)
alter table public.documents
  add column if not exists content_text text;

-- 5. document_type enum — add 'gp_press_release'
alter table public.documents
  drop constraint if exists documents_document_type_check;

alter table public.documents
  add constraint documents_document_type_check
  check (document_type in (
    'board_minutes',
    'press_release',
    'annual_report',
    'agenda',
    'gp_press_release',
    'other'
  ));

-- 6. Seed GPs. Placeholder URLs — verify & update as needed.
insert into public.gps (name, homepage_url, press_releases_url)
values
  ('Blackstone', 'https://www.blackstone.com', 'https://www.blackstone.com/news/press/'),
  ('KKR',        'https://www.kkr.com',        'https://www.kkr.com/investor-relations/press-releases'),
  ('Apollo',     'https://www.apollo.com',     'https://www.apollo.com/news')
on conflict do nothing;

comment on column public.documents.gp_id is
  'FK to gps for GP-side press releases. Either plan_id or gp_id should be set per row.';
comment on column public.documents.content_text is
  'Plain-text content for documents whose source is HTML (gp_press_release). Null for PDF docs.';
