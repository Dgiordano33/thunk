-- Extend existing routine trigger storage; delivery cursors live in trigger_state.
alter table public.routine_runs drop constraint routine_runs_trigger_source_check;
alter table public.routine_runs add constraint routine_runs_trigger_source_check
  check (trigger_source in ('manual', 'cron', 'webhook', 'pr_opened', 'run_failed', 'ci_failed', 'review_requested', 'deploy_ready'));
