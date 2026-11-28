-- The rest of config/workers/state.json: the delegation queue, model races, per-task cost history
-- and the relay task ledger. As in 0023, task and session ids carry no foreign keys so history
-- outlives deleted tasks and the import never fails on a stale id.

-- Waiting delegations, started in seq order when a slot frees and dependencies are done.
create table public.worker_queue (
  task_id uuid primary key,
  project_id uuid not null references public.projects (id) on delete cascade,
  seq bigint generated always as identity,
  chief_session_id uuid,
  -- the delegate input to start it with
  input jsonb not null,
  depends_on jsonb not null default '[]',
  queued_at timestamptz not null default now()
);
create index worker_queue_project_idx on public.worker_queue (project_id, seq);

-- The same task run on two or three models; winner is the session the person picked.
create table public.worker_races (
  id uuid primary key,
  project_id uuid not null references public.projects (id) on delete cascade,
  task_id uuid not null,
  -- [{ sessionId, workspaceId, model }]
  entries jsonb not null,
  winner uuid,
  created_at timestamptz not null default now()
);
create index worker_races_task_idx on public.worker_races (task_id);

-- What delegating a task cost and how many rounds it took.
create table public.task_stats (
  task_id uuid primary key,
  project_id uuid not null references public.projects (id) on delete cascade,
  title text not null,
  models jsonb not null default '[]',
  mode text not null check (mode in ('worktree', 'scout')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  duration_ms bigint not null default 0,
  cost_usd double precision not null default 0,
  rounds integer not null default 0,
  outcome text,
  -- `${sessionId}:${seq}` of each counted finish, so a recovered report is not counted twice
  counted jsonb not null default '[]'
);
create index task_stats_project_idx on public.task_stats (project_id, started_at desc);

-- Which tasks a relayed request created, by `id:<task id>` and by normalized title, so recovery
-- reuses them instead of starting the same work twice.
create table public.relay_tasks (
  relay_id uuid not null,
  key text not null,
  task_id uuid not null,
  project_id uuid not null references public.projects (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (relay_id, key)
);

alter table public.worker_queue enable row level security;
alter table public.worker_races enable row level security;
alter table public.task_stats enable row level security;
alter table public.relay_tasks enable row level security;
grant all on public.worker_queue, public.worker_races, public.task_stats, public.relay_tasks to service_role;
