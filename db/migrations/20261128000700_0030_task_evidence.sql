-- What "done" means for a task, and what shows it. Criteria are optional: a list of
-- { id, text, kind } with kind test | interaction | visual | source | other. criteria_version goes up
-- whenever they change, so evidence gathered against an older list can be marked as such.
alter table public.tasks add column criteria jsonb;
alter table public.tasks add column criteria_version integer not null default 0;

-- A chief's plan proposes criteria per task; they are approved with the plan.
alter table public.delegation_plan_tasks add column criteria jsonb;

-- One row per piece of evidence. origin separates what Thunk saw (observed: trial merges, PR checks,
-- previews, tests it ran) from what an agent reported (claimed). commit_sha and criteria_version record
-- which revision and which criteria the row covers. session_id has no foreign key so history outlives sessions.
create table public.task_evidence (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  criterion_id text,
  origin text not null check (origin in ('observed', 'claimed')),
  type text not null check (type in ('test', 'ci', 'merge', 'preview', 'screenshot', 'source', 'note')),
  status text not null check (status in ('pass', 'fail', 'unknown')),
  detail text not null default '',
  ref text,
  commit_sha text,
  criteria_version integer not null default 0,
  session_id uuid,
  created_at timestamptz not null default now()
);
create index task_evidence_task_idx on public.task_evidence (task_id, created_at desc);

alter table public.task_evidence enable row level security;
grant all on public.task_evidence to service_role;
