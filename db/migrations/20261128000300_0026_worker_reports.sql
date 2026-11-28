-- Worker reports and their delivery to the chief, from config/worker-reports/<session>.json.
-- A report is the outbox entry for one finished turn (session_id, seq); delivered_at is set once
-- the chief has it. Delivered reports are kept as history rather than pruned like the files were.
-- session_id has no foreign key so imported reports of deleted sessions still load.

create table public.worker_reports (
  session_id uuid not null,
  seq integer not null,
  project_id uuid not null references public.projects (id) on delete cascade,
  content text not null,
  chief_session_id uuid,
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  primary key (session_id, seq)
);
create index worker_reports_undelivered_idx on public.worker_reports (chief_session_id) where delivered_at is null;

alter table public.worker_reports enable row level security;
grant all on public.worker_reports to service_role;
