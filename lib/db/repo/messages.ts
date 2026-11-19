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
  return ids;
}

export async function loadEvents(sessionId: string): Promise<HarnessEvent[]> {
  const client = db();
  if (!client) return [];
  const rows = await client.query<{ content_json: Json }>("select content_json from messages where session_id = $1 order by seq", [sessionId]);
  return rows.map((row) => row.content_json as unknown as HarnessEvent);
}

export async function maxSeq(sessionId: string): Promise<number> {
  const client = db();
  if (!client) return 0;
  const [row] = await client.query<{ seq: number }>("select seq from messages where session_id = $1 order by seq desc limit 1", [sessionId]);
  return row?.seq ?? 0;
}
