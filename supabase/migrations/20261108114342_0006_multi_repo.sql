-- Multi-repo projects and workspaces.
--
-- A project's own root/kind/remote/default_branch still describe its primary
-- repo (or folder). project_repos lists the additional repos the project spans.
-- workspace_repos records, per workspace, where each additional repo is checked
-- out: its own git worktree on the workspace's branch, or the repo itself
-- (in place) for the main workspace and workspaces created without worktrees.

create table public.project_repos (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null,
  path text not null,
  remote text,
  default_branch text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_repos_project_path_key unique (project_id, path),
  constraint project_repos_project_name_key unique (project_id, name)
);
create trigger project_repos_updated_at before update on public.project_repos
  for each row execute function public.set_updated_at();

create table public.workspace_repos (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  -- Restrict: removing a repo that still has worktrees would orphan them on disk.
  repo_id uuid not null references public.project_repos (id) on delete restrict,
  cwd text not null,
  branch text,
  worktree_path text,
  base_ref text,
  created_at timestamptz not null default now(),
  primary key (workspace_id, repo_id)
);
create index workspace_repos_repo_idx on public.workspace_repos (repo_id);

alter table public.project_repos enable row level security;
alter table public.workspace_repos enable row level security;
revoke all on public.project_repos from anon, authenticated;
revoke all on public.workspace_repos from anon, authenticated;
create policy "service role full access" on public.project_repos
  as permissive for all to service_role using (true) with check (true);
create policy "service role full access" on public.workspace_repos
  as permissive for all to service_role using (true) with check (true);
