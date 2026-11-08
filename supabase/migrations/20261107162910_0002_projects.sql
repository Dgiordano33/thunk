-- Hierarchy: project (repo or folder) -> workspace (task; optionally its own git
-- worktree; memory shared by its sessions) -> session (one chat).
--
-- Existing workspaces were keyed by cwd alone. Each becomes a folder/repo
-- project rooted at that cwd with a single "main" workspace working in-place.

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  root text not null unique,
  kind text not null default 'folder' check (kind in ('repo', 'folder')),
  remote text,
  default_branch text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger projects_updated_at before update on public.projects
  for each row execute function public.set_updated_at();

alter table public.workspaces
  add column project_id uuid references public.projects (id) on delete cascade,
  add column slug text,
  add column branch text,
  add column worktree_path text,
  add column base_ref text,
  add column status text not null default 'active' check (status in ('active', 'archived'));

insert into public.projects (name, root)
select name, cwd from public.workspaces
on conflict (root) do nothing;

update public.workspaces w
set project_id = p.id, slug = 'main', name = 'main'
from public.projects p
where p.root = w.cwd;

alter table public.workspaces
  alter column project_id set not null,
  alter column slug set not null,
  drop constraint workspaces_cwd_key,
  add constraint workspaces_project_slug_key unique (project_id, slug);
create index workspaces_project_updated_idx on public.workspaces (project_id, updated_at desc);

alter table public.projects enable row level security;
revoke all on public.projects from anon, authenticated;
create policy "service role full access" on public.projects
  as permissive for all to service_role using (true) with check (true);
