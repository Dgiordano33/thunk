-- Routines: standing orders that start agent sessions on a schedule, on demand,
-- or when something happens (a new PR, a failing run script, a local webhook).
-- Each firing is a routine_run linked to the session it started.

create table public.routines (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null,
  prompt text not null,
  model text not null,
  permission_mode text not null default 'acceptEdits',
  target_kind text not null default 'ephemeral' check (target_kind in ('workspace', 'ephemeral')),
  target_workspace_id uuid references public.workspaces (id) on delete set null,
  schedule_cron text,
  schedule_tz text,
  events text[] not null default '{}',
  webhook_token text unique,
  enabled boolean not null default true,
  catch_up text not null default 'skip' check (catch_up in ('skip', 'once')),
  max_runs_per_day integer not null default 24,
  max_run_minutes integer not null default 60,
  -- PR poll cursor and seen PR numbers.
  trigger_state jsonb not null default '{}'::jsonb,
  last_run_at timestamptz,
  next_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index routines_project_idx on public.routines (project_id);
create index routines_due_idx on public.routines (next_run_at) where enabled and next_run_at is not null;

create table public.routine_runs (
  id uuid primary key default gen_random_uuid(),
  routine_id uuid not null references public.routines (id) on delete cascade,
  session_id uuid references public.sessions (id) on delete set null,
  workspace_id uuid references public.workspaces (id) on delete set null,
  trigger_source text not null check (trigger_source in ('manual', 'cron', 'webhook', 'pr_opened', 'run_failed')),
  trigger_payload jsonb,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'needs_attention', 'succeeded', 'failed', 'cancelled')),
  started_at timestamptz,
  finished_at timestamptz,
  cost_usd numeric(12, 6) not null default 0,
  summary text,
  diff_stat jsonb,
  pr_url text,
  note_id text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index routine_runs_routine_created_idx on public.routine_runs (routine_id, created_at desc);
create index routine_runs_open_idx on public.routine_runs (status) where status in ('queued', 'running', 'needs_attention');

-- Session provenance, e.g. { kind: "routine", routineId, runId, routineName }.
alter table public.sessions add column origin jsonb;

create trigger routines_updated_at before update on public.routines
  for each row execute function public.set_updated_at();
create trigger routine_runs_updated_at before update on public.routine_runs
  for each row execute function public.set_updated_at();

do $$
declare
  t text;
begin
  foreach t in array array['routines', 'routine_runs']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format(
      'create policy "service role full access" on public.%I as permissive for all to service_role using (true) with check (true)',
      t
    );
  end loop;
end;
$$;
