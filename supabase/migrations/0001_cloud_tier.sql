-- Echo Cloud — Stage 1 schema.
-- Run this once in the Supabase SQL Editor (Project → SQL Editor → New query
-- → paste this whole file → Run). Safe to re-run (everything is IF NOT
-- EXISTS / OR REPLACE / DROP-then-CREATE for the trigger).

-- ── profiles ──────────────────────────────────────────────────────
-- One row per authenticated user. Created automatically on signup via the
-- trigger below — the app never inserts into this table directly.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  tier text not null default 'free_cloud' check (tier in ('free_cloud', 'paid_cloud')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "users can read own profile" on public.profiles;
create policy "users can read own profile"
  on public.profiles for select
  using (auth.uid() = id);

-- No insert/update policy for regular users — profile rows are only ever
-- written by the trigger (as the table owner) or the server's service-role
-- key, both of which bypass RLS.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── usage_daily ───────────────────────────────────────────────────
-- Fast per-day quota counter. One row per (user, day); incremented
-- atomically by increment_daily_usage() below. This is what the proxy
-- checks on every request before calling the model.
create table if not exists public.usage_daily (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null default current_date,
  message_count int not null default 0,
  primary key (user_id, usage_date)
);

alter table public.usage_daily enable row level security;

drop policy if exists "users can read own usage" on public.usage_daily;
create policy "users can read own usage"
  on public.usage_daily for select
  using (auth.uid() = user_id);

-- No write policy — only the server (service-role key, bypasses RLS) or the
-- security-definer function below can write here.

create or replace function public.increment_daily_usage(p_user_id uuid, p_limit int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  current_count int;
begin
  insert into public.usage_daily (user_id, usage_date, message_count)
  values (p_user_id, current_date, 1)
  on conflict (user_id, usage_date)
  do update set message_count = usage_daily.message_count + 1
  returning message_count into current_count;

  return current_count <= p_limit;
end;
$$;

-- ── usage_events ──────────────────────────────────────────────────
-- Detailed per-request audit log (token counts). Not used for the quota
-- check itself (usage_daily is faster for that) — this is here for future
-- token-based billing / cost analysis once Stage 3 (Stripe metering) lands.
create table if not exists public.usage_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'gemini',
  model text,
  input_tokens int,
  output_tokens int,
  created_at timestamptz not null default now()
);

alter table public.usage_events enable row level security;

drop policy if exists "users can read own usage events" on public.usage_events;
create policy "users can read own usage events"
  on public.usage_events for select
  using (auth.uid() = user_id);

-- No write policy — only the server (service-role key) inserts here.
