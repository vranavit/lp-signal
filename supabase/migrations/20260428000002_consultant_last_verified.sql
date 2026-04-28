alter table public.plan_consultants
  add column if not exists last_verified_at timestamptz;

comment on column public.plan_consultants.last_verified_at is
  'When this relationship was last confirmed against its source. Populated for source_type=manual_research entries; null for cafr_extraction (use source_document.processed_at instead).';
