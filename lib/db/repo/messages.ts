import "server-only";
import type { HarnessEvent } from "@/lib/agent/types";
import type { Json } from "../types";
import { db } from "../server";
import { insertSql, run } from "../sql";

export function roleFor(e: HarnessEvent): "user" | "assistant" | "tool" | "system" {
  switch (e.type) {
    case "user_message":
      return "user";
    case "turn_start":
    case "text_delta":
    case "thinking_delta":
    case "turn_complete":
    case "plan_proposed":
      return "assistant";
    case "tool_use":
    case "tool_result":
    case "permission_request":
    case "permission_resolved":
    case "ask_question":
    case "question_resolved":
    case "question_escalated":
    case "plan_resolved":
      return "tool";
    default:
      return "system";
  }
}

function markdownFor(e: HarnessEvent): string | null {
  if (e.type === "user_message") return e.content;
  if (e.type === "turn_complete") return e.markdown || null;
  if (e.type === "plan_proposed") return e.plan;
  return null;
}

/** Insert events; returns seq → message id for linking documents. */
export async function insertEvents(sessionId: string, events: HarnessEvent[]): Promise<Map<number, string>> {
  const client = db();
  const ids = new Map<number, string>();
  if (!client || events.length === 0) return ids;
  const rows = await run<{ id: string; seq: number }>(client, insertSql(
    "messages",
    events.map((e) => ({
      session_id: sessionId,
      seq: e.seq,
      type: e.type,
      role: roleFor(e),
      content_json: e as unknown as Json,
      markdown: markdownFor(e),
      created_at: new Date(e.ts).toISOString(),
    })),
    { onConflict: "session_id,seq", returning: "id, seq" },
  ));
  for (const row of rows) ids.set(row.seq, row.id);
  const results = events.filter((e) => e.type === "result");
  if (results.length) await insertUsageResults(client, sessionId, results);
  return ids;
}

type ResultEvent = Extract<HarnessEvent, { type: "result" }>;
const costOf = (e: ResultEvent) => (typeof e.costUsd === "number" && Number.isFinite(e.costUsd) && e.costUsd >= 0 ? e.costUsd : null);
const tokens = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.round(n) : null);

/**
 * One `usage_results` row per stored result event, so usage totals read a narrow table instead of every
 * message's JSON. Workspace and project come from the session row; a replayed batch changes nothing.
 */
async function insertUsageResults(client: NonNullable<ReturnType<typeof db>>, sessionId: string, results: ResultEvent[]) {
  const rows = results.map((e) => ({
    seq: e.seq,
    ts: new Date(Number.isFinite(e.ts) ? e.ts : Date.now()).toISOString(),
    cost_usd: costOf(e),
    input_tokens: tokens(e.usage?.inputTokens),
    output_tokens: tokens(e.usage?.outputTokens),
    cache_read_tokens: tokens(e.usage?.cacheReadTokens),
    cache_creation_tokens: tokens(e.usage?.cacheCreationTokens),
  }));
  await client.query(
    `insert into usage_results (session_id, seq, workspace_id, project_id, day, ts, cost_usd, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens)
     select s.id, r.seq, s.workspace_id, w.project_id, (r.ts at time zone 'UTC')::date, r.ts, r.cost_usd, r.input_tokens, r.output_tokens, r.cache_read_tokens, r.cache_creation_tokens
     from jsonb_to_recordset($2::jsonb) as r(seq integer, ts timestamptz, cost_usd numeric, input_tokens bigint, output_tokens bigint, cache_read_tokens bigint, cache_creation_tokens bigint)
     join sessions s on s.id = $1
     left join workspaces w on w.id = s.workspace_id
     on conflict (session_id, seq) do nothing`,
    [sessionId, JSON.stringify(rows)],
  );
}

/** A session's persisted events in order; `after` skips those up to that seq (SSE replay). */
export async function loadEvents(sessionId: string, opts: { after?: number } = {}): Promise<HarnessEvent[]> {
  const client = db();
  if (!client) return [];
  const rows = await client.query<{ content_json: Json }>(
    "select content_json from messages where session_id = $1 and seq > $2 order by seq",
    [sessionId, opts.after ?? -1],
  );
  return rows.map((row) => row.content_json as unknown as HarnessEvent);
}

export async function maxSeq(sessionId: string): Promise<number> {
  const client = db();
  if (!client) return 0;
  const [row] = await client.query<{ seq: number }>("select seq from messages where session_id = $1 order by seq desc limit 1", [sessionId]);
  return row?.seq ?? 0;
}
