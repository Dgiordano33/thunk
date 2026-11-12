-- Routines can attach notes and tasks whose current content each run reads,
-- and fire when a task is created or completed.
alter table public.routines add column context jsonb not null default '{"notes": [], "taskIds": []}'::jsonb;

alter table public.routine_runs drop constraint routine_runs_trigger_source_check;
alter table public.routine_runs add constraint routine_runs_trigger_source_check
  check (trigger_source in ('manual', 'cron', 'webhook', 'pr_opened', 'run_failed', 'ci_failed', 'review_requested', 'deploy_ready', 'task_created', 'task_completed'));
