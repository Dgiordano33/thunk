-- A finished worker whose branch has changes opens a review card (kind review_ready) instead of an
-- informational worker_report: its diff, trial merge and pull request in one place.
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in ('capture_ready', 'worker_report', 'review_ready', 'delegation_plan', 'permission', 'question', 'plan', 'turn_finished', 'turn_failed', 'session_error', 'session_stuck', 'run_needs_attention', 'run_succeeded', 'run_failed', 'ci_failed', 'ci_stuck', 'review_requested', 'deploy_ready', 'pr_merged', 'script_failed', 'agent_request'));
