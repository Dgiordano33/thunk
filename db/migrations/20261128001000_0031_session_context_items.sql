-- What each session was given: items in its system prompt (rewritten on every start and resume),
-- files it read later from notes, memory or the Vault, and items attached while it ran.
-- The prompt used to be assembled and thrown away, so nobody could see what an agent knew.
create table public.session_context_items (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  kind text not null check (kind in ('memory', 'instructions', 'note', 'task', 'vault', 'routine')),
  -- Note id, task id, Vault id, or 'project' / 'workspace' for memory and instructions.
  ref_id text not null,
  title text not null,
  -- The file behind the item, so the current version can be compared with what was sent.
  path text,
  mode text not null check (mode in ('full', 'truncated', 'index', 'omitted')),
  -- Why an item was cut or left out (over a limit, not marked to inject, not pinned).
  reason text,
  chars integer not null default 0,
  -- Notes have no history: a hash of the text the session got is the version.
  content_hash text,
  -- The note text the session got, so Send update can send a diff rather than the whole note.
  content text,
  origin text not null check (origin in ('prompt', 'fetched', 'attached')),
  -- Remove: left out of the prompt from the next start or resume (the running prompt can't change).
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, origin, kind, ref_id)
);
create index session_context_items_path_idx on public.session_context_items (path) where path is not null;
alter table public.session_context_items enable row level security;
grant all on public.session_context_items to service_role;
