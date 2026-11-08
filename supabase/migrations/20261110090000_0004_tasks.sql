create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  workspace_id uuid references public.workspaces (id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 200),
  body text check (length(body) <= 20000),
  status text not null default 'open' check (status in ('open', 'in_progress', 'blocked', 'done', 'cancelled')),
  priority smallint not null default 0 check (priority between 0 and 3),
  position double precision not null default 0,
  created_by text not null default 'user' check (created_by in ('user', 'agent', 'routine')),
  session_id uuid references public.sessions (id) on delete set null,
  created_in_session_id uuid references public.sessions (id) on delete set null,
  note_id text,
  due_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tasks_project_idx on public.tasks (project_id, status, position);
create index tasks_workspace_idx on public.tasks (workspace_id, status, position) where workspace_id is not null;
create index tasks_session_idx on public.tasks (session_id) where session_id is not null;
create trigger tasks_updated_at before update on public.tasks
  for each row execute function public.set_updated_at();
alter table public.tasks enable row level security;
revoke all on public.tasks from anon, authenticated;
create policy "service role full access" on public.tasks as permissive for all to service_role using (true) with check (true);
