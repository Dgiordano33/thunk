-- Memory changes arrive as proposals the person reviews (Harvest's "Propose an update", the Memory upkeep routine).
-- MEMORY.md stays plain markdown; a proposal records what would change, why, and from which sources.
-- base_hash is the hash of MEMORY.md the proposal was written against, so Apply can tell when memory moved since.
-- workspace/session/run ids are plain columns: the proposal outlives the workspace that produced it.
create table public.memory_proposals (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  workspace_id uuid,
  session_id uuid,
  run_id uuid,
  origin text not null check (origin in ('harvest', 'upkeep', 'agent')),
  status text not null default 'open' check (status in ('open', 'applied', 'rejected', 'empty')),
  base_hash text not null,
  summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index memory_proposals_project on public.memory_proposals (project_id, created_at desc);
create index memory_proposals_session on public.memory_proposals (session_id);
create index memory_proposals_run on public.memory_proposals (run_id);
alter table public.memory_proposals enable row level security;
grant all on public.memory_proposals to service_role;

-- One change each. target is the exact existing text a replace or remove acts on; sources are task, session, note or workspace ids.
-- flag explains why an item could not be applied, e.g. its target is no longer in memory.
create table public.memory_proposal_items (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.memory_proposals (id) on delete cascade,
  position integer not null,
  op text not null check (op in ('add', 'replace', 'remove')),
  target text,
  text text,
  kind text check (kind in ('decision', 'workaround')),
  sources jsonb not null default '[]',
  reason text not null default '',
  review_after date,
  decision text not null default 'pending' check (decision in ('pending', 'accepted', 'rejected')),
  edited_text text,
  flag text
);
create index memory_proposal_items_proposal on public.memory_proposal_items (proposal_id, position);
alter table public.memory_proposal_items enable row level security;
grant all on public.memory_proposal_items to service_role;

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in ('capture_ready', 'worker_report', 'delegation_plan', 'permission', 'question', 'plan', 'turn_finished', 'turn_failed', 'session_error', 'session_stuck', 'run_needs_attention', 'run_succeeded', 'run_failed', 'ci_failed', 'ci_stuck', 'review_requested', 'deploy_ready', 'pr_merged', 'script_failed', 'agent_request', 'memory_proposal'));
