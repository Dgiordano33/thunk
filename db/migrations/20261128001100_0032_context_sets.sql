-- Saved selections of notes, tasks and Vault items. A routine can point at one
-- (routines.context.setId) instead of keeping its own list, and a new session can
-- start with one attached, so a useful bundle of context is picked once.
create table public.context_sets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  -- [{ "scope": { "kind": "projects" | "workspaces" | "repos", "id": … }, "id": noteId }]
  notes jsonb not null default '[]'::jsonb,
  task_ids jsonb not null default '[]'::jsonb,
  vault_ids jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, name)
);
alter table public.context_sets enable row level security;
grant all on public.context_sets to service_role;
