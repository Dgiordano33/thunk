-- Revisions reach the work they change. A task remembers the plan document or note it was delegated from.
-- version counts the revisions Thunk has seen (1 at delegation); delivered_version is the one the worker was given,
-- so a report can say which version it implements. content is the last text seen, the base for the next diff;
-- content_hash tells a note save that changed nothing from one that did.
create table public.task_sources (
  task_id uuid not null references public.tasks (id) on delete cascade,
  source_kind text not null check (source_kind in ('document', 'note')),
  source_id text not null,
  version integer not null default 1,
  content_hash text,
  content text,
  delivered_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (task_id, source_kind, source_id)
);
create index task_sources_source_idx on public.task_sources (source_kind, source_id);
alter table public.task_sources enable row level security;
grant all on public.task_sources to service_role;

-- One revision of a source and what the chief proposes for its open tasks. waiting: sent to the chief as a
-- <source_revision>; open: the chief proposed changes and the plan_changed card is in the Inbox; applied once the
-- person decided every task; dismissed when nothing needed changing or the person set it aside.
-- items: one per task, { taskId, title, affected, summary, brief, criteria, decision, delivery }.
create table public.plan_changes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  source_kind text not null check (source_kind in ('document', 'note')),
  source_id text not null,
  source_title text not null default '',
  version integer not null,
  diff text not null,
  chief_session_id uuid,
  status text not null default 'waiting' check (status in ('waiting', 'open', 'applied', 'dismissed')),
  items jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index plan_changes_project_idx on public.plan_changes (project_id, created_at desc);
alter table public.plan_changes enable row level security;
grant all on public.plan_changes to service_role;

-- A worker report is stamped with the source version the worker had been sent: "Implements plan v3".
alter table public.worker_reports add column source_version jsonb;
-- A plan can name the document it implements; otherwise approval links the chief's latest document.
alter table public.delegation_plans add column source_document_id text;

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in ('capture_ready', 'worker_report', 'review_ready', 'delegation_plan', 'permission', 'question', 'plan', 'turn_finished', 'turn_failed', 'session_error', 'session_stuck', 'run_needs_attention', 'run_succeeded', 'run_failed', 'ci_failed', 'ci_stuck', 'review_requested', 'deploy_ready', 'pr_merged', 'script_failed', 'agent_request', 'plan_changed'));
