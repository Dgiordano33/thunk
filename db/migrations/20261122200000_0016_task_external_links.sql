-- A task can mirror an issue in another tracker (Linear). Linear owns the issue; external_updated_at is the
-- issue's updatedAt when Thunk last applied it, so only changes made in Linear since then overwrite the task.
alter table public.tasks
  add column external_source text check (external_source in ('linear')),
  add column external_id text,
  add column external_key text,
  add column external_url text,
  add column external_updated_at timestamptz;
create unique index tasks_external_idx on public.tasks (project_id, external_source, external_id) where external_id is not null;
alter table public.tasks drop constraint tasks_created_by_check;
alter table public.tasks add constraint tasks_created_by_check check (created_by in ('user', 'agent', 'routine', 'integration'));
