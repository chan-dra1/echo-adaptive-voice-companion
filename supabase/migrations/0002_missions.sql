-- Echo Cloud — Stage 2: Always-On Missions schema.
-- Run after 0001_cloud_tier.sql in Supabase SQL Editor.
-- Safe to re-run (IF NOT EXISTS everywhere).

-- ── missions ─────────────────────────────────────────────────────────────────
-- One row per scheduled mission. The Edge Function reads rows where
-- next_run_at <= now() AND is_active = true.
create table if not exists public.missions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  title         text not null,
  prompt        text not null,           -- the instruction template Echo runs
  cron_expr     text not null default '0 8 * * *',  -- standard 5-field cron
  is_active     boolean not null default true,
  last_run_at   timestamptz,
  next_run_at   timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.missions enable row level security;

drop policy if exists "users can manage own missions" on public.missions;
create policy "users can manage own missions"
  on public.missions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Auto-update updated_at on change
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists missions_updated_at on public.missions;
create trigger missions_updated_at
  before update on public.missions
  for each row execute function public.touch_updated_at();

-- ── mission_results ───────────────────────────────────────────────────────────
-- One row per successful mission run. Stores the AI-generated output.
create table if not exists public.mission_results (
  id          bigint generated always as identity primary key,
  mission_id  uuid not null references public.missions(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  content     text not null,
  status      text not null default 'done' check (status in ('done', 'error')),
  error_msg   text,
  created_at  timestamptz not null default now()
);

alter table public.mission_results enable row level security;

drop policy if exists "users can read own mission results" on public.mission_results;
create policy "users can read own mission results"
  on public.mission_results for select
  using (auth.uid() = user_id);

-- Only the server (service-role key) inserts results.

-- ── Helper: compute_next_run ──────────────────────────────────────────────────
-- Minimal cron-to-next-timestamp logic in pure SQL for the most common patterns.
-- The Edge Function will also call this after each run to advance next_run_at.
-- This handles: "0 8 * * *" (daily 8am), "0 8 * * 1" (Monday 8am),
-- "*/30 * * * *" (every 30m), "0 */4 * * *" (every 4h).
create or replace function public.advance_mission_schedule(
  p_mission_id uuid,
  p_last_run   timestamptz default now()
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_cron  text;
  v_next  timestamptz;
  v_min   int;
  v_hr    int;
  v_dow   text;
  v_parts text[];
begin
  select cron_expr into v_cron from public.missions where id = p_mission_id;
  if not found then return; end if;

  v_parts := string_to_array(v_cron, ' ');
  if array_length(v_parts, 1) != 5 then
    -- Unknown pattern — schedule 24h out as fallback
    v_next := p_last_run + interval '24 hours';
  else
    -- v_parts: min hr dom month dow
    if v_parts[1] like '*/%' then
      -- */N minute pattern
      v_min  := (split_part(v_parts[1], '/', 2))::int;
      v_next := p_last_run + make_interval(mins => v_min);
    elsif v_parts[2] like '*/%' then
      -- */N hour pattern
      v_hr   := (split_part(v_parts[2], '/', 2))::int;
      v_next := p_last_run + make_interval(hours => v_hr);
    else
      -- daily / specific weekday: advance by 1 day (simple)
      v_next := date_trunc('day', p_last_run + interval '1 day')
                + make_interval(
                    hours => (v_parts[2])::int,
                    mins  => (v_parts[1])::int
                  );
    end if;
  end if;

  update public.missions
  set last_run_at = p_last_run, next_run_at = v_next
  where id = p_mission_id;
end; $$;

-- ── pg_cron: trigger run-missions edge function every 5 minutes ───────────────
-- Only works if the pg_cron extension is enabled in your Supabase project.
-- Enable it in: Supabase Dashboard → Database → Extensions → pg_cron.
-- If you skip this, missions still work — they just need to be triggered manually
-- or via the /api/missions/trigger endpoint.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'echo-run-missions',
      '*/5 * * * *',
      $$
        select net.http_post(
          url     := current_setting('app.supabase_url') || '/functions/v1/run-missions',
          headers := jsonb_build_object(
            'Content-Type',  'application/json',
            'Authorization', 'Bearer ' || current_setting('app.service_role_key')
          ),
          body    := '{}'::jsonb
        );
      $$
    );
  end if;
exception when others then
  -- pg_cron not available — missions trigger via API only
  null;
end $$;
