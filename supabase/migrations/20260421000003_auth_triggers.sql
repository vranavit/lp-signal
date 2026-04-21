-- Auth hooks for LP Signal
-- 1. Gate sign-ins to emails in public.allowed_emails
-- 2. Auto-create a user_profiles row when a new auth.users row appears

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Allowlist gate
--    Runs BEFORE an auth.users row is inserted. If the email is not in
--    allowed_emails, raise an exception so Supabase Auth rejects the sign-in.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.enforce_signin_allowlist()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_email text := lower(new.email);
begin
  if normalized_email is null then
    raise exception 'sign-in rejected: no email on user record';
  end if;

  if not exists (
    select 1 from public.allowed_emails where lower(email) = normalized_email
  ) then
    raise exception 'sign-in rejected: % is not on the access list', normalized_email;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_signin_allowlist on auth.users;
create trigger enforce_signin_allowlist
  before insert on auth.users
  for each row execute function public.enforce_signin_allowlist();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Auto-create user_profiles row on new auth.users insert
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_profiles (id, email, role)
  values (new.id, new.email, 'admin')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
