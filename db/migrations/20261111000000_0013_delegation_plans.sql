-- The chief's proposed task split waits for approval in the inbox.
alter table notifications drop constraint notifications_kind_check;
alter table notifications add constraint notifications_kind_check
  check (kind in ('permission', 'question', 'plan', 'turn_finished', 'turn_failed', 'session_error', 'session_stuck', 'run_needs_attention', 'run_succeeded', 'run_failed', 'ci_failed', 'ci_stuck', 'review_requested', 'deploy_ready', 'pr_merged', 'script_failed', 'agent_request', 'worker_report', 'delegation_plan'));
