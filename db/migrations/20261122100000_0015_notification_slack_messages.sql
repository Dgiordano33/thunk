-- The Slack DM sent for a notification, so Thunk can mark it settled when the notification resolves.
create table public.notification_slack_messages (
  notification_id uuid primary key references public.notifications (id) on delete cascade,
  channel text not null,
  ts text not null,
  created_at timestamptz not null default now()
);
alter table public.notification_slack_messages enable row level security;
revoke all on public.notification_slack_messages from anon, authenticated;
create policy "service role full access" on public.notification_slack_messages as permissive for all to service_role using (true) with check (true);
