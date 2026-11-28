-- Durable routine triggers: an outbox between "this routine should run" and "a run started".
-- The cron tick, PR poll and delivery poll insert a row here and advance their cursor (next_run_at or
-- trigger_state) in one statement, so a crash can neither lose a firing nor fire it twice. The scheduler's
-- dispatcher starts pending rows that are due and records the run (lib/routines/dispatch.ts).
create table public.routine_triggers (
  id uuid primary key default gen_random_uuid(),
  routine_id uuid not null references public.routines (id) on delete cascade,
  -- The run trigger the dispatcher passes to startRun (cron, pr_opened, ci_failed, …).
  source text not null,
  -- One row per firing, e.g. cron:<routineId>:<nextRunAt> or pr:<routineId>:<url>; a repeat insert is a no-op.
  dedupe_key text not null unique,
  payload jsonb,
  status text not null default 'pending' check (status in ('pending', 'started', 'skipped', 'failed')),
  -- startRun calls that threw; a busy slot doesn't count.
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  -- The run it started, or the "Skipped" row written when it gave up.
  run_id uuid references public.routine_runs (id) on delete set null,
  -- Why it was skipped or failed.
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index routine_triggers_pending_idx on public.routine_triggers (next_attempt_at) where status = 'pending';
create index routine_triggers_run_idx on public.routine_triggers (run_id) where run_id is not null;

create trigger routine_triggers_updated_at before update on public.routine_triggers
  for each row execute function public.set_updated_at();

alter table public.routine_triggers enable row level security;
revoke all on public.routine_triggers from anon, authenticated;
create policy "service role full access" on public.routine_triggers as permissive for all to service_role using (true) with check (true);
