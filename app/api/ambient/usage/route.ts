import { listLiveSessions } from "@/lib/agent";
import type { HarnessEvent } from "@/lib/agent/types";
import { summarizeUsage } from "@/lib/ambient/summary";
import type { UsageEntry } from "@/lib/ambient/types";
import { handle, HttpError } from "@/lib/api/http";
import { db } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request) => {
  const timeZone = new URL(req.url).searchParams.get("timeZone") || "UTC";
  try { new Intl.DateTimeFormat("en", { timeZone }); }
  catch { throw new HttpError(400, "Invalid time zone"); }
  const entries: UsageEntry[] = [];
  const workspaceBySession = new Map<string, string>();
  const client = db();
  if (client) {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await client.from("messages")
        .select("session_id, seq, content_json, sessions(workspace_id)")
        .eq("type", "result").order("id").range(from, from + 999);
      if (error) throw error;
      for (const row of data) {
        const event = row.content_json as unknown as Extract<HarnessEvent, { type: "result" }>;
        entries.push({ sessionId: row.session_id, seq: row.seq, ts: event.ts, costUsd: event.costUsd });
        if (row.sessions) workspaceBySession.set(row.session_id, row.sessions.workspace_id);
      }
      if (data.length < 1000) break;
    }
  }
  for (const live of listLiveSessions()) {
    workspaceBySession.set(live.id, live.meta.workspaceId);
    for (const event of live.events) {
      if (event.type === "result") entries.push({ sessionId: live.id, seq: event.seq, ts: event.ts, costUsd: event.costUsd });
    }
  }
  return Response.json({ ...summarizeUsage(entries, workspaceBySession, timeZone), persistent: Boolean(client) });
});
