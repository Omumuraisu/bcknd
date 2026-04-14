-- Supabase user data mapping (incremental rollout)
-- Purpose:
-- 1) Keep auth.users as source of identity
-- 2) Mirror user metadata into a public table with RLS
-- 3) Link existing app accounts to auth.users via Account.supabase_user_id

create table if not exists public.auth_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  phone text,
  username text,
  is_active boolean not null default true,
  role text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.auth_profiles add column if not exists username text;
alter table public.auth_profiles add column if not exists is_active boolean not null default true;
alter table public.auth_profiles add column if not exists role text;

create unique index if not exists idx_auth_profiles_username_unique
  on public.auth_profiles (lower(username))
  where username is not null;

alter table public.auth_profiles enable row level security;

drop policy if exists "auth_profiles_select_own" on public.auth_profiles;
create policy "auth_profiles_select_own"
  on public.auth_profiles
  for select
  to authenticated
  using ((select auth.uid()) = id);

drop policy if exists "auth_profiles_update_own" on public.auth_profiles;
create policy "auth_profiles_update_own"
  on public.auth_profiles
  for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create or replace function public.handle_auth_user_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.auth_profiles (id, email, phone, username, is_active, role, raw_user_meta_data)
  values (
    new.id,
    new.email,
    new.phone,
    nullif(lower(coalesce(new.raw_user_meta_data->>'username', '')), ''),
    coalesce((new.raw_user_meta_data->>'is_active')::boolean, true),
    nullif(new.raw_user_meta_data->>'role', ''),
    coalesce(new.raw_user_meta_data, '{}'::jsonb)
  )
  on conflict (id) do update
    set email = excluded.email,
        phone = excluded.phone,
        username = coalesce(excluded.username, public.auth_profiles.username),
        is_active = coalesce(excluded.is_active, public.auth_profiles.is_active),
        role = coalesce(excluded.role, public.auth_profiles.role),
        raw_user_meta_data = excluded.raw_user_meta_data,
        updated_at = timezone('utc', now());

  -- Bridge mapping for pre-created app accounts.
  -- This will only link rows that are currently unmapped.
  update public."Account"
  set supabase_user_id = new.id::text,
      email = coalesce(new.email, public."Account".email),
      phone = coalesce(new.phone, public."Account".phone)
  where supabase_user_id is null
    and (
      (new.email is not null and lower(public."Account".email) = lower(new.email))
      or (new.phone is not null and public."Account".phone = new.phone)
    );

  return new;
exception
  when others then
    -- Avoid blocking signups if app-side mapping logic fails.
    raise warning 'handle_auth_user_created warning: %', sqlerrm;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_auth_user_created();
