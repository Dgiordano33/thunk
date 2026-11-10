import "server-only";
import type { HarnessEvent } from "@/lib/agent/types";
import type { Json } from "../types";
import { db } from "../server";

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
  const { data, error } = await client
    .from("messages")
    .upsert(
      events.map((e) => ({
        session_id: sessionId,
        seq: e.seq,
        type: e.type,
        role: roleFor(e),
        content_json: e as unknown as Json,
        markdown: markdownFor(e),
        created_at: new Date(e.ts).toISOString(),
      })),
      { onConflict: "session_id,seq" },
    )
    .select("id, seq");
  if (error) throw error;
  for (const row of data) ids.set(row.seq, row.id);
  return ids;
}

export async function loadEvents(sessionId: string): Promise<HarnessEvent[]> {
  const client = db();
  if (!client) return [];
  const out: HarnessEvent[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from("messages")
      .select("content_json")
      .eq("session_id", sessionId)
      .order("seq", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    for (const row of data) out.push(row.content_json as unknown as HarnessEvent);
    if (data.length < PAGE) break;
  }
  return out;
}

export async function maxSeq(sessionId: string): Promise<number> {
  const client = db();
  if (!client) return 0;
  const { data, error } = await client
    .from("messages")
    .select("seq")
    .eq("session_id", sessionId)
    .order("seq", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.seq ?? 0;
}
