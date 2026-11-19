create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('permission', 'question', 'plan', 'turn_finished', 'turn_failed', 'session_error', 'session_stuck', 'run_needs_attention', 'run_succeeded', 'run_failed', 'ci_failed', 'ci_stuck', 'review_requested', 'deploy_ready', 'pr_merged', 'script_failed', 'agent_request')),
  urgency text not null check (urgency in ('action', 'info')),
  project_id uuid not null references public.projects(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete set null,
  -- Sessions can emit before their asynchronous persistence has inserted the session row.
  session_id uuid,
  run_id uuid references public.routine_runs(id) on delete set null,
  subject_key text not null,
  title text not null,
  detail text,
  href text not null,
  actions jsonb not null default '[]'::jsonb check (jsonb_typeof(actions) = 'array'),
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  read_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index notifications_open_subject_idx on public.notifications(subject_key) where status = 'open';
create index notifications_status_idx on public.notifications(status, created_at desc);
create index notifications_project_idx on public.notifications(project_id, status);
create index notifications_session_idx on public.notifications(session_id) where status = 'open';
create trigger notifications_updated_at before update on public.notifications
  for each row execute function public.set_updated_at();
alter table public.notifications enable row level security;
revoke all on public.notifications from anon, authenticated;
create policy "service role full access" on public.notifications as permissive for all to service_role using (true) with check (true);
