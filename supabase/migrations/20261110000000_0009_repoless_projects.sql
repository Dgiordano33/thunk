-- Repo-less projects: a project is a name, every repo is equal, zero repos is legal.
--
-- projects.data_key replaces projects.root as the key of ~/.thunk/projects/<key>/.
-- Each project's root becomes an ordinary project_repos row and each workspace's
-- checkout of it an ordinary workspace_repos row, so both sort first.
--
-- The old columns stay (a later migration drops them), so this is reversible until
-- someone creates a repo-less project or removes a former primary. It must ship with
-- the code that reads the new shape: older code does not set data_key on insert.

-- 1. data_key matches projectSlug(root) in lib/projects/paths.ts, so no directory moves.
alter table public.projects add column data_key text;

update public.projects
set data_key = coalesce(
  nullif(regexp_replace(regexp_replace(root, '[^a-zA-Z0-9]+', '-', 'g'), '^-+|-+$', '', 'g'), ''),
  'root'
);

-- Roots like /a/b and /a-b already share a directory. The oldest keeps it; the rest start a new one.
update public.projects p
set data_key = p.data_key || '-' || left(p.id::text, 8)
from (
  select id, row_number() over (partition by data_key order by created_at, id) as position
  from public.projects
) ranked
where ranked.id = p.id and ranked.position > 1;

alter table public.projects
  alter column data_key set not null,
  add constraint projects_data_key_key unique (data_key);

-- 2. A repo row can be a plain folder.
alter table public.project_repos
  add column kind text not null default 'repo' check (kind in ('repo', 'folder'));

-- 3. One repo row per project root. created_at makes it sort first; the project is older than any added repo.
insert into public.project_repos (project_id, name, path, kind, remote, default_branch, created_at)
select
  p.id,
  case
    when exists (select 1 from public.project_repos r where r.project_id = p.id and r.name = p.name)
      then p.name || '-' || left(p.id::text, 4)
    else p.name
  end,
  p.root, p.kind, p.remote, p.default_branch, p.created_at
from public.projects p
on conflict (project_id, path) do nothing;

-- 4. One checkout per workspace of that repo, stamped before the workspace's other checkouts.
insert into public.workspace_repos (workspace_id, repo_id, cwd, branch, worktree_path, base_ref, created_at)
select w.id, r.id, w.cwd, w.branch, w.worktree_path, w.base_ref, w.created_at
from public.workspaces w
join public.projects p on p.id = w.project_id
join public.project_repos r on r.project_id = p.id and r.path = p.root
on conflict (workspace_id, repo_id) do nothing;

-- 5. Notebooks of the old primary now point at its repo row.
update public.project_repo_folders f
set repo_id = r.id
from public.projects p
join public.project_repos r on r.project_id = p.id and r.path = p.root
where f.repo_id is null and f.project_id = p.id;

drop index public.project_repo_folders_path_key;
alter table public.project_repo_folders alter column repo_id set not null;
create unique index project_repo_folders_path_key on public.project_repo_folders (project_id, repo_id, path);

-- 6. A root is no longer required, and directories are looked up across projects.
alter table public.projects
  alter column root drop not null,
  drop constraint projects_root_key;
create index workspaces_cwd_idx on public.workspaces (cwd);
create index project_repos_path_idx on public.project_repos (path);

-- 7. RESTRICT fires as soon as the project delete cascades to project_repos, before workspaces are gone.
-- NO ACTION checks at the end of the statement, so deleting a project works and dropping a repo that still
-- has checkouts is still refused.
alter table public.workspace_repos
  drop constraint workspace_repos_repo_id_fkey,
  add constraint workspace_repos_repo_id_fkey
    foreign key (repo_id) references public.project_repos (id) on delete no action;
