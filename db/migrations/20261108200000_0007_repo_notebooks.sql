create table public.project_repo_folders (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  repo_id uuid references public.project_repos(id) on delete cascade,
  path text not null check (path <> '' and path !~ '(^/|\\|(^|/)(\.|\.\.|\.git)(/|$)|//|/$)'),
  label text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index project_repo_folders_path_key on public.project_repo_folders
  (project_id, coalesce(repo_id, '00000000-0000-0000-0000-000000000000'::uuid), path);
create trigger project_repo_folders_updated_at before update on public.project_repo_folders
  for each row execute function public.set_updated_at();
alter table public.project_repo_folders enable row level security;
revoke all on public.project_repo_folders from anon, authenticated;
create policy "service role full access" on public.project_repo_folders
  as permissive for all to service_role using (true) with check (true);
