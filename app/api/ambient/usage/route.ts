import { listLiveSessions } from "@/lib/agent";
import type { HarnessEvent } from "@/lib/agent/types";
import { summarizeUsage } from "@/lib/ambient/summary";
import type { UsageEntry } from "@/lib/ambient/types";
import { handle, HttpError } from "@/lib/api/http";
import { db } from "@/lib/db/server";

export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request) => {
  const timeZone = new URL(req.url).searchParams.get("timeZone") || "UTC";
  try { new Intl.DateTimeFormat("en", { timeZone }); }
  catch { throw new HttpError(400, "Invalid time zone"); }
  const entries: UsageEntry[] = [];
  const workspaceBySession = new Map<string, string>();
  const client = db();
  if (client) {
    const rows = await client.query<{ session_id: string; seq: number; content_json: unknown; workspace_id: string | null }>(
      "select m.session_id, m.seq, m.content_json, s.workspace_id from messages m left join sessions s on s.id = m.session_id where m.type = 'result'",
    );
    for (const row of rows) {
      const event = row.content_json as Extract<HarnessEvent, { type: "result" }>;
      entries.push({ sessionId: row.session_id, seq: row.seq, ts: event.ts, costUsd: event.costUsd });
      if (row.workspace_id) workspaceBySession.set(row.session_id, row.workspace_id);
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
