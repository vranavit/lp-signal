-- Add the missing authenticated-read SELECT policies for the consultant
-- tables. Migration 20260427000017 enabled RLS on consultants and
-- plan_consultants but did not add the read policy that every other
-- public table in this schema has, so the dashboard's anon-key Supabase
-- client (acting as the authenticated role) was returning zero rows.

create policy "consultants_read_authenticated"
  on public.consultants for select
  to authenticated
  using (true);

create policy "plan_consultants_read_authenticated"
  on public.plan_consultants for select
  to authenticated
  using (true);
