-- Delegation plans and trial merges move out of config/workers/state.json so they can be joined to
-- tasks and read by the review card. Task and session ids carry no foreign keys: the imported files
-- can name tasks or sessions that were deleted since, and the history should outlive them.

create table public.delegation_plans (
  id uuid primary key,
  project_id uuid not null references public.projects (id) on delete cascade,
  chief_session_id uuid not null,
  relay_id uuid,
  summary text not null,
  note_id text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  note text
);
create index delegation_plans_project_idx on public.delegation_plans (project_id, created_at desc);

-- One row per proposed task, in plan order. task_id is set once approval delegates it.
create table public.delegation_plan_tasks (
  plan_id uuid not null references public.delegation_plans (id) on delete cascade,
  key text not null,
  position integer not null,
  title text not null,
  brief text not null,
  model text,
  mode text check (mode in ('worktree', 'scout')),
  depends_on jsonb not null default '[]',
  race jsonb,
  task_id uuid,
  primary key (plan_id, key)
);
create index delegation_plan_tasks_task_idx on public.delegation_plan_tasks (task_id);

-- Every trial merge, with what workers_integrate found. replaced_at is set when a newer one
-- supersedes it and its workspace is archived; the row stays as history.
create table public.integrations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  workspace_id uuid not null,
  branch text,
  created_at timestamptz not null default now(),
  replaced_at timestamptz,
  -- [{ taskId, title, repo, branch, uncommitted }]
  merged jsonb,
  -- [{ taskId, title, repo, branch, files }]
  conflicts jsonb,
  -- { command, exitCode, output } or { command: null, reason }
  tests jsonb,
  -- [{ taskId, repo, branch, sha }]: each worker branch's head when it was merged, to tell when a result is out of date
  head_shas jsonb
);
create index integrations_project_idx on public.integrations (project_id, created_at desc);

create table public.integration_tasks (
  integration_id uuid not null references public.integrations (id) on delete cascade,
  task_id uuid not null,
  position integer not null,
  primary key (integration_id, task_id)
);
create index integration_tasks_task_idx on public.integration_tasks (task_id);

alter table public.delegation_plans enable row level security;
alter table public.delegation_plan_tasks enable row level security;
alter table public.integrations enable row level security;
alter table public.integration_tasks enable row level security;
grant all on public.delegation_plans, public.delegation_plan_tasks, public.integrations, public.integration_tasks to service_role;
