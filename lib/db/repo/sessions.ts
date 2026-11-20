import { cache } from "react";
import "server-only";
import type { SessionMeta, SessionState } from "@/lib/agent/types";
import type { SessionOrigin } from "@/lib/agent/types";
import type { Json, TablesUpdate } from "../types";
import { db } from "../server";
import { insertSql, run, updateSql } from "../sql";
import { listTasks, updateTask } from "./tasks";

export type SessionRow = Omit<SessionMeta, "live"> & { totalCostUsd: number; updatedAt: string };

type Row = {
  id: string;
  workspace_id: string;
  project_id: string | null;
  sdk_session_id: string | null;
  title: string | null;
  cwd: string;
  model: string;
  permission_mode: string;
  status: string;
  total_cost_usd: number;
  origin: Json | null;
  created_at: string;
  updated_at: string;
};

const SELECT =
  "select s.id, s.workspace_id, s.sdk_session_id, s.title, s.cwd, s.model, s.permission_mode, s.status, s.total_cost_usd, s.origin, s.created_at, s.updated_at, w.project_id " +
  "from sessions s left join workspaces w on w.id = s.workspace_id";

function toSession(r: Row): SessionRow {
  return {
    id: r.id,
    projectId: r.project_id ?? "",
    workspaceId: r.workspace_id,
    sdkSessionId: r.sdk_session_id,
    title: r.title,
    cwd: r.cwd,
    model: r.model,
    permissionMode: r.permission_mode,
    status: r.status as SessionState,
    totalCostUsd: Number(r.total_cost_usd),
    origin: (r.origin as SessionOrigin | null) ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function upsertSession(meta: Omit<SessionMeta, "live">) {
  const client = db();
  if (!client) return;
  await run(client, insertSql("sessions", {
    id: meta.id,
    workspace_id: meta.workspaceId,
    sdk_session_id: meta.sdkSessionId ?? null,
    title: meta.title ?? null,
    cwd: meta.cwd,
    model: meta.model,
    permission_mode: meta.permissionMode,
    status: meta.status,
    origin: (meta.origin ?? null) as Json,
    created_at: meta.createdAt,
  }, { onConflict: "id" }));
}

export async function updateSession(id: string, patch: TablesUpdate<"sessions">) {
  const client = db();
  if (!client) return;
  const statement = updateSql("sessions", patch, "id = $1", [id]);
  if (statement) await run(client, statement);
}

export async function addSessionCost(id: string, costUsd: number) {
  const client = db();
  if (!client || !costUsd) return;
  await client.query("update sessions set total_cost_usd = total_cost_usd + $1 where id = $2", [costUsd, id]);
}

export const getSessionRow = cache(async (id: string): Promise<SessionRow | null> => {
  const client = db();
  if (!client) return null;
  const [row] = await client.query<Row>(`${SELECT} where s.id = $1`, [id]);
  return row ? toSession(row) : null;
});

export async function listSessionRows(opts: { workspaceId?: string; projectId?: string; limit?: number } = {}) {
  const client = db();
  if (!client) return [];
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.workspaceId) { params.push(opts.workspaceId); where.push(`s.workspace_id = $${params.length}`); }
  if (opts.projectId) { params.push(opts.projectId); where.push(`w.project_id = $${params.length}`); }
  params.push(opts.limit ?? 50);
  const rows = await client.query<Row>(`${SELECT}${where.length ? ` where ${where.join(" and ")}` : ""} order by s.updated_at desc limit $${params.length}`, params);
  return rows.map(toSession);
}

export async function deleteSessionRow(id: string): Promise<void> {
  const client = db();
  if (!client) {
    for (const task of await listTasks()) {
      if (task.sessionId === id || task.createdInSessionId === id) {
        await updateTask(task.id, {
          ...(task.sessionId === id ? { sessionId: null } : {}),
          ...(task.createdInSessionId === id ? { createdInSessionId: null } : {}),
        });
      }
    }
    return;
  }
  await client.query("delete from sessions where id = $1", [id]);
}

/** Worker ownership survives server restarts, unlike the live activity feed. */
export async function workerWorkspaceIds(): Promise<Set<string>> {
  const client = db();
  if (!client) return new Set();
  const rows = await client.query<{ workspace_id: string }>("select workspace_id from sessions where origin->>'kind' = 'worker'");
  return new Set(rows.map((row) => row.workspace_id));
}
