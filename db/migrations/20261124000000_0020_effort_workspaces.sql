alter table workspaces add column visibility text not null default 'workspace'
  check (visibility in ('project', 'workspace'));
-- Preserve existing checkouts and history, but retire the automatic Local sidebar row.
update workspaces set visibility = 'project' where slug = 'main';
