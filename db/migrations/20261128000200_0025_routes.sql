-- The top chief's routing plans and the requests it routed to project chiefs, from the Home
-- project's config/routing/state.json. A route names its target project by id without a foreign
-- key, so routes to a project deleted since still import and keep their history.

create table public.route_plans (
  id uuid primary key,
  summary text not null,
  note_id text,
  -- [{ projectId, workspaceId?, title, brief, why, line? }]
  items jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  note text
);

-- ref is the short id written onto the note line (r:<ref>).
create table public.routes (
  ref text primary key,
  plan_id uuid not null,
  project_id uuid not null,
  project_name text not null,
  workspace_id uuid,
  title text not null,
  brief text not null,
  note_id text,
  status text not null default 'routed' check (status in ('routed', 'done', 'blocked', 'failed')),
  summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index routes_plan_idx on public.routes (plan_id, created_at);
create index routes_project_idx on public.routes (project_id, status);

alter table public.route_plans enable row level security;
alter table public.routes enable row level security;
grant all on public.route_plans, public.routes to service_role;
