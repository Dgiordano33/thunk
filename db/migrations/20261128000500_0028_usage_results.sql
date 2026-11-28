-- One row per agent turn result, so the usage panel sums a narrow table instead of reading the JSON of every
-- `result` message on each request. Written by insertEvents alongside the message row; the primary key makes
-- replays and the backfill below idempotent.
--
-- Rows go with their session (on delete cascade), as the messages they mirror do, so totals stay what the
-- old computation over `messages` reported. `day` is the UTC day for cheap range queries; the endpoint buckets
-- by the viewer's time zone from `ts`. Cost is null when the event carried no usable number (the old
-- computation skipped those too). Token counts are the turn's main-loop usage, null on events that predate it.
create table public.usage_results (
  session_id uuid not null references public.sessions (id) on delete cascade,
  seq integer not null,
  workspace_id uuid,
  project_id uuid,
  day date not null,
  ts timestamptz not null,
  cost_usd numeric,
  input_tokens bigint,
  output_tokens bigint,
  cache_read_tokens bigint,
  cache_creation_tokens bigint,
  primary key (session_id, seq)
);
create index usage_results_day_idx on public.usage_results (day);
create index usage_results_workspace_idx on public.usage_results (workspace_id);

alter table public.usage_results enable row level security;
grant all on public.usage_results to service_role;

-- Backfill from stored result events. Fields are read defensively: anything missing or of the wrong JSON type
-- becomes null (or falls back to the message's created_at for the time).
with results as (
  select
    m.session_id,
    m.seq,
    s.workspace_id,
    w.project_id,
    case when jsonb_typeof(m.content_json -> 'ts') = 'number'
      then to_timestamp((m.content_json ->> 'ts')::double precision / 1000)
      else m.created_at end as ts,
    case when jsonb_typeof(m.content_json -> 'costUsd') = 'number' and (m.content_json ->> 'costUsd')::numeric >= 0
      then (m.content_json ->> 'costUsd')::numeric end as cost_usd,
    case when jsonb_typeof(m.content_json #> '{usage,inputTokens}') = 'number'
      then round((m.content_json #>> '{usage,inputTokens}')::numeric)::bigint end as input_tokens,
    case when jsonb_typeof(m.content_json #> '{usage,outputTokens}') = 'number'
      then round((m.content_json #>> '{usage,outputTokens}')::numeric)::bigint end as output_tokens,
    case when jsonb_typeof(m.content_json #> '{usage,cacheReadTokens}') = 'number'
      then round((m.content_json #>> '{usage,cacheReadTokens}')::numeric)::bigint end as cache_read_tokens,
    case when jsonb_typeof(m.content_json #> '{usage,cacheCreationTokens}') = 'number'
      then round((m.content_json #>> '{usage,cacheCreationTokens}')::numeric)::bigint end as cache_creation_tokens
  from public.messages m
  join public.sessions s on s.id = m.session_id
  left join public.workspaces w on w.id = s.workspace_id
  where m.type = 'result'
)
insert into public.usage_results (session_id, seq, workspace_id, project_id, day, ts, cost_usd, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens)
select session_id, seq, workspace_id, project_id, (ts at time zone 'UTC')::date, ts, cost_usd, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens
from results
on conflict (session_id, seq) do nothing;
