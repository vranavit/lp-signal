alter table public.plan_consultants
  drop constraint plan_consultants_source_type_check;

alter table public.plan_consultants
  add constraint plan_consultants_source_type_check
  check (source_type in (
    'cafr_extraction',
    'industry_knowledge',
    'manual_research',
    'rfp_database',
    'press_release',
    'plan_disclosure'
  ));

comment on constraint plan_consultants_source_type_check on public.plan_consultants is
  'Allowed source types: cafr_extraction (auto-extracted from ingested ACFR), manual_research (manually verified from external source URL), industry_knowledge (educated guess pending verification), rfp_database/press_release/plan_disclosure (specific source subtypes, optional).';
