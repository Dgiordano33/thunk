-- A routine can DM its run report to you on Slack when a run ends (lib/integrations/slack/reports.ts).
alter table public.routines add column slack_report boolean not null default false;
