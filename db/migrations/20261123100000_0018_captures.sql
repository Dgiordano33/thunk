create table public.captures (
 id uuid primary key, text text not null, status text not null check (status in ('routing','queued','working','ready','kept','discarded','failed')),
 project_id uuid references projects(id), task_id uuid references tasks(id), workspace_id uuid references workspaces(id), session_id uuid,
 mode text check (mode in ('scout','worktree')), title text, assumptions jsonb not null default '[]', next_step text, summary text,
 diff_stat jsonb, cost_usd double precision not null default 0, error text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index captures_task on captures(task_id);
alter table public.captures enable row level security;
grant all on public.captures to service_role;
