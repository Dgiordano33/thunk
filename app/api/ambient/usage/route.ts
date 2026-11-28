import { listLiveSessions } from "@/lib/agent";
import { summarizeUsage, type UsageBucket } from "@/lib/ambient/summary";
import type { UsageEntry } from "@/lib/ambient/types";
import { handle, HttpError } from "@/lib/api/http";
import { db, type Db } from "@/lib/db/server";

export const dynamic = "force-dynamic";

/** Stored cost summed by the viewer's day and workspace. */
async function storedBuckets(client: Db, timeZone: string): Promise<{ buckets: UsageBucket[]; entries: UsageEntry[]; workspaces: Map<string, string> }> {
  try {
    const rows = await client.query<{ day: string; workspace_id: string | null; cost: number }>(
      "select to_char((ts at time zone $1::text)::date, 'YYYY-MM-DD') as day, workspace_id, sum(cost_usd) as cost from usage_results where cost_usd is not null group by 1, 2",
      [timeZone],
    );
    return { buckets: rows.map((r) => ({ day: r.day, workspaceId: r.workspace_id, cost: Number(r.cost) })), entries: [], workspaces: new Map() };
  } catch {
    // A zone Intl accepts but Postgres doesn't know: bucket the rows here instead.
    const rows = await client.query<{ session_id: string; seq: number; ts: string; cost_usd: number; workspace_id: string | null }>(
      "select session_id, seq, ts, cost_usd, workspace_id from usage_results where cost_usd is not null",
    );
    const workspaces = new Map<string, string>();
    for (const r of rows) if (r.workspace_id) workspaces.set(r.session_id, r.workspace_id);
    return { buckets: [], entries: rows.map((r) => ({ sessionId: r.session_id, seq: r.seq, ts: Date.parse(r.ts), costUsd: Number(r.cost_usd) })), workspaces };
  }
}

export const GET = handle(async (req: Request) => {
  const timeZone = new URL(req.url).searchParams.get("timeZone") || "UTC";
  try { new Intl.DateTimeFormat("en", { timeZone }); }
  catch { throw new HttpError(400, "Invalid time zone"); }
  const client = db();
  const live = listLiveSessions();
  const stored = client ? await storedBuckets(client, timeZone) : { buckets: [], entries: [], workspaces: new Map<string, string>() };
  const entries = stored.entries;
  const workspaceBySession = stored.workspaces;
  // Results a live session hasn't flushed yet; the stored ones are already in the buckets.
  const flushed = new Set<string>();
  if (client && live.length) {
    const rows = await client.query<{ session_id: string; seq: number }>(
      "select session_id::text as session_id, seq from usage_results where session_id::text = any($1::text[])",
      [live.map((l) => l.id)],
    );
    for (const r of rows) flushed.add(`${r.session_id}:${r.seq}`);
  }
  for (const session of live) {
    workspaceBySession.set(session.id, session.meta.workspaceId);
    for (const event of session.events) {
      if (event.type === "result" && !flushed.has(`${session.id}:${event.seq}`)) entries.push({ sessionId: session.id, seq: event.seq, ts: event.ts, costUsd: event.costUsd });
    }
  }
  return Response.json({ ...summarizeUsage(entries, workspaceBySession, timeZone, stored.buckets), persistent: Boolean(client) });
});
