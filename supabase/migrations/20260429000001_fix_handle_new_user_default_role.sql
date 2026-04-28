-- Fix: handle_new_user trigger was hardcoding role='admin'
-- on signup, contradicting the column default 'user' and
-- creating a silent privilege escalation by default.
--
-- Resolution: change trigger to use the column default ('user')
-- explicitly. Existing admin rows for owners are preserved.
--
-- Audit ref: Audit 5 P5.1
-- Surfaced: 2026-04-28 during Audit 2 housekeeping (Nicholas
-- Cheung signup investigation, in which his profile was
-- created with role='admin' and immediately demoted by hand)
-- Fixed: 2026-04-29
-- Predecessor: supabase/migrations/20260421000003_auth_triggers.sql
-- (where the hardcoded 'admin' originated)

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_profiles (id, email, role)
  values (new.id, new.email, 'user')
  on conflict (id) do nothing;
  return new;
end;
$$;

comment on function public.handle_new_user() is
  'AFTER INSERT trigger on auth.users. Mirrors signup into public.user_profiles with role=''user'' (least privilege). Existing admin role assignments for owner accounts are preserved as direct UPDATEs to user_profiles. Audit ref: P5.1 fix 2026-04-29.';
