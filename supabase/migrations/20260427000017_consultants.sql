-- Workstream 2 Phase A: consultant relationships layer.
--
-- Adds two tables to track which consulting firms advise which pension
-- plans on which mandates.
--
-- `consultants`: master list of investment consulting firms with their
-- aliases (for matching extracted names against canonical brands) and
-- default specialty mandates (used to infer mandate_type when a plan's
-- disclosure is single-bucket / Category B).
--
-- `plan_consultants`: relationship table. One row per (plan_id,
-- consultant_id, mandate_type, fee_year). Supports both auto-extracted
-- rows (source_type='cafr_extraction', source_document_id set) and
-- manually-researched rows (source_type='industry_knowledge' etc.,
-- source_document_id null).
--
-- Unique constraint uses NULLS NOT DISTINCT so multiple manual entries
-- for the same (plan, consultant, mandate) without a fee_year still
-- collide on insert. Postgres 15+ syntax (Supabase supports).

create table if not exists public.consultants (
  id                  uuid primary key default gen_random_uuid(),
  canonical_name      text not null unique,
  name_aliases        text[] not null default '{}',
  website             text,
  headquarters        text,
  default_specialties text[] not null default '{}',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint consultants_default_specialties_check
    check (
      default_specialties <@ array[
        'general',
        'private_equity',
        'real_estate',
        'real_assets',
        'hedge_funds',
        'infrastructure',
        'fixed_income',
        'public_equity',
        'endowment_consulting'
      ]::text[]
    )
);

create table if not exists public.plan_consultants (
  id                 uuid primary key default gen_random_uuid(),
  plan_id            uuid not null references public.plans(id) on delete cascade,
  consultant_id      uuid not null references public.consultants(id) on delete restrict,
  mandate_type       text not null check (
    mandate_type in (
      'general',
      'private_equity',
      'real_estate',
      'real_assets',
      'hedge_funds',
      'infrastructure',
      'fixed_income',
      'public_equity',
      'other'
    )
  ),
  engaged_since      date,
  engaged_through    date,
  fee_usd            numeric(15, 2),
  fee_year           integer,
  source_document_id uuid references public.documents(id) on delete set null,
  source_excerpt     text,
  source_type        text not null check (
    source_type in (
      'cafr_extraction',
      'industry_knowledge',
      'rfp_database',
      'press_release',
      'plan_disclosure'
    )
  ),
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint plan_consultants_unique_mandate_year
    unique nulls not distinct (plan_id, consultant_id, mandate_type, fee_year)
);

create index if not exists plan_consultants_plan_id_idx
  on public.plan_consultants (plan_id);
create index if not exists plan_consultants_consultant_id_idx
  on public.plan_consultants (consultant_id);

alter table public.consultants enable row level security;
alter table public.plan_consultants enable row level security;
-- No authenticated policies - service-role-only access for now.
-- /pensions/[slug] reads via createSupabaseAdminClient (admin path
-- already used by /admin/ingestion).

comment on table public.consultants is
  'Master list of investment consulting firms. Pre-populated with ~18 known firms via scripts/populate-consultants.ts; new entries added on demand.';
comment on column public.consultants.canonical_name is
  'Canonical brand form (e.g. "Aon", "NEPC"). Unique. Used as the display label.';
comment on column public.consultants.name_aliases is
  'Alternative name forms found in source documents (e.g. "Aon Investments", "Hewitt EnnisKnupp"). Used by the classifier to match extracted strings against the canonical entry.';
comment on column public.consultants.default_specialties is
  'Mandate-type specialties this firm is known for. Used to infer mandate_type when a plan discloses consultants without categorizing them (Category B plans).';

comment on table public.plan_consultants is
  'Plan-to-consultant relationships. One row per (plan, consultant, mandate_type, fee_year). Supports auto-extracted rows (source_type=cafr_extraction, source_document_id set) and manually-researched rows (source_type=industry_knowledge etc., source_document_id null).';
comment on column public.plan_consultants.fee_year is
  'Fiscal year of the disclosed fee_usd. Null for manual entries without a specific year. The unique constraint uses NULLS NOT DISTINCT so multiple manual entries for the same plan+consultant+mandate without a fee_year still collide on insert.';
comment on column public.plan_consultants.source_type is
  'Provenance of the row. cafr_extraction = parsed from a CAFR document; industry_knowledge = manual entry with no document source; rfp_database = sourced from a public RFP database; press_release = from a press release; plan_disclosure = from non-CAFR plan publications.';
