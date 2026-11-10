-- A repo notebook can expose only some of its folder's Markdown files. null = every file in the folder.
alter table public.project_repo_folders add column files text[];
