-- Thunk: single-user local harness. The Next server talks to Postgres with the
-- service-role key; RLS is enabled everywhere with service-role-only policies,
-- so the anon/authenticated keys can read nothing.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  cwd text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.sessions (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  sdk_session_id text,
  title text,
  cwd text not null,
  model text not null,
  permission_mode text not null,
  status text not null default 'idle',
  total_cost_usd numeric(12, 6) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index sessions_workspace_created_idx on public.sessions (workspace_id, created_at desc);
create index sessions_updated_idx on public.sessions (updated_at desc);

-- Append-only harness event log. Streaming deltas are coalesced per text segment
-- before insert, so replaying rows by seq through the client reducer rebuilds a session.
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  seq integer not null,
  type text not null,
  role text not null check (role in ('user', 'assistant', 'tool', 'system')),
  content_json jsonb not null,
  markdown text,
  created_at timestamptz not null default now(),
  unique (session_id, seq)
);

create table public.documents (
  id uuid primary key,
  session_id uuid not null references public.sessions (id) on delete cascade,
  message_id uuid unique references public.messages (id) on delete set null,
  kind text not null default 'response' check (kind in ('response', 'plan')),
  parent_document_id uuid references public.documents (id) on delete set null,
  version integer not null default 1,
  original_markdown text not null,
  -- original_markdown after an editor parse/serialize round trip; diffs run against this
  baseline_markdown text,
  current_markdown text not null,
  -- TipTap JSON incl. comment marks: the source of truth for anchors on rehydrate
  content_json jsonb,
  status text not null default 'draft' check (status in ('draft', 'sent', 'approved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index documents_session_idx on public.documents (session_id);
create index documents_parent_idx on public.documents (parent_document_id);

-- Root comment: id = thread_id and carries the anchor. Replies share thread_id.
-- v2: kind = 'side_chat' threads get model replies (author = 'assistant').
create table public.comments (
  id uuid primary key,
  document_id uuid not null references public.documents (id) on delete cascade,
  thread_id uuid not null,
  anchor jsonb,
  body text not null,
  kind text not null default 'change' check (kind in ('change', 'question', 'side_chat')),
  status text not null default 'open' check (status in ('open', 'resolved')),
  author text not null default 'user' check (author in ('user', 'assistant')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index comments_document_idx on public.comments (document_id);
create index comments_thread_idx on public.comments (thread_id);

create table public.document_revisions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  diff text,
  payload text not null,
  stat jsonb,
  sent_at timestamptz not null default now()
);
create index document_revisions_document_idx on public.document_revisions (document_id);

create table public.tool_calls (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  tool_use_id text not null unique,
  name text not null,
  input jsonb,
  output text,
  is_error boolean not null default false,
  status text not null default 'running' check (status in ('running', 'done', 'error')),
  approval text check (approval in ('allow', 'deny', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tool_calls_session_idx on public.tool_calls (session_id);

create trigger workspaces_updated_at before update on public.workspaces
  for each row execute function public.set_updated_at();
create trigger sessions_updated_at before update on public.sessions
  for each row execute function public.set_updated_at();
create trigger documents_updated_at before update on public.documents
  for each row execute function public.set_updated_at();
create trigger comments_updated_at before update on public.comments
  for each row execute function public.set_updated_at();
create trigger tool_calls_updated_at before update on public.tool_calls
  for each row execute function public.set_updated_at();

do $$
declare
  t text;
begin
  foreach t in array array['workspaces', 'sessions', 'messages', 'documents', 'comments', 'document_revisions', 'tool_calls']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format(
      'create policy "service role full access" on public.%I as permissive for all to service_role using (true) with check (true)',
      t
    );
  end loop;
end;
$$;
