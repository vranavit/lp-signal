-- Confidence-tiered auto-approval, part 2/2.
--
-- Sink for signals the classifier emitted but rejected for low confidence
-- (or future: other rejection reasons). Used for prompt tuning — we sample
-- this table to find false rejects and adjust thresholds or prompt wording.
--
-- Intentionally NOT linked to public.signals via FK. These rows never become
-- signals; if the prompt improves later we re-run classification from the
-- raw document rather than promoting rejections.

create table if not exists public.rejected_signals (
  id                uuid primary key default gen_random_uuid(),
  document_id       uuid references public.documents(id) on delete set null,
  plan_id           uuid not null references public.plans(id) on delete cascade,
  signal_type       int  not null check (signal_type in (1, 2, 3)),
  confidence        numeric(3, 2) not null check (confidence between 0 and 1),
  asset_class       text check (asset_class in ('PE', 'Infra', 'Credit', 'RE', 'VC', 'Other')),
  summary           text not null,
  fields            jsonb not null default '{}'::jsonb,
  source_page       int,
  source_quote      text not null,
  rejection_reason  text not null default 'low_confidence',
  model_version     text,
  prompt_version    text,
  created_at        timestamptz not null default now()
);

create index if not exists rejected_signals_plan_idx
  on public.rejected_signals (plan_id);

create index if not exists rejected_signals_created_idx
  on public.rejected_signals (created_at desc);

create index if not exists rejected_signals_reason_idx
  on public.rejected_signals (rejection_reason);

-- RLS: default-deny. This table is internal tuning data; only the admin
-- (service-role) client should read it, and the admin client bypasses RLS.
-- Enabling RLS with zero policies blocks the anon/authenticated roles
-- completely — safer than leaving RLS off on a public-schema table.
alter table public.rejected_signals enable row level security;

comment on table public.rejected_signals is
  'Classifier outputs that failed the minimum-confidence gate (<0.70). Internal tuning data; not customer-visible.';
