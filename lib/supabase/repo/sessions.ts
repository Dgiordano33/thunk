import "server-only";
import type { SessionMeta, SessionState } from "@/lib/agent/types";
import type { SessionOrigin } from "@/lib/agent/types";
import type { Json, TablesUpdate } from "../types";
import { db } from "../server";
import { listTasks, updateTask } from "./tasks";

export type SessionRow = Omit<SessionMeta, "live"> & { totalCostUsd: number; updatedAt: string };

type Row = {
  id: string;
  workspace_id: string;
  workspaces: { project_id: string } | null;
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

const COLUMNS =
  "id, workspace_id, sdk_session_id, title, cwd, model, permission_mode, status, total_cost_usd, origin, created_at, updated_at, workspaces(project_id)";

function toSession(r: Row): SessionRow {
  return {
    id: r.id,
    projectId: r.workspaces?.project_id ?? "",
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
  const { error } = await client.from("sessions").upsert(
    {
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
    },
    { onConflict: "id" },
  );
  if (error) throw error;
}

export async function updateSession(id: string, patch: TablesUpdate<"sessions">) {
  const client = db();
  if (!client) return;
  const { error } = await client.from("sessions").update(patch).eq("id", id);
  if (error) throw error;
}

export async function addSessionCost(id: string, costUsd: number) {
  const client = db();
  if (!client || !costUsd) return;
  const { data } = await client.from("sessions").select("total_cost_usd").eq("id", id).single();
  await client
    .from("sessions")
    .update({ total_cost_usd: Number(data?.total_cost_usd ?? 0) + costUsd })
    .eq("id", id);
}

export async function getSessionRow(id: string): Promise<SessionRow | null> {
  const client = db();
  if (!client) return null;
  const { data, error } = await client.from("sessions").select(COLUMNS).eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? toSession(data as unknown as Row) : null;
}

export async function listSessionRows(opts: { workspaceId?: string; projectId?: string; limit?: number } = {}) {
  const client = db();
  if (!client) return [];
  let q = client
    .from("sessions")
    .select(opts.projectId ? COLUMNS.replace("workspaces(project_id)", "workspaces!inner(project_id)") : COLUMNS)
    .order("updated_at", { ascending: false })
    .limit(opts.limit ?? 50);
  if (opts.workspaceId) q = q.eq("workspace_id", opts.workspaceId);
  if (opts.projectId) q = q.eq("workspaces.project_id", opts.projectId);
  const { data, error } = await q;
  if (error) throw error;
  return (data as unknown as Row[]).map(toSession);
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
  const { error } = await client.from("sessions").delete().eq("id", id);
  if (error) throw error;
}

/** Worker ownership survives server restarts, unlike the live activity feed. */
export async function workerWorkspaceIds(): Promise<Set<string>> {
  const client = db();
  if (!client) return new Set();
  const { data, error } = await client.from("sessions").select("workspace_id").eq("origin->>kind", "worker");
  if (error) throw error;
  return new Set(data.map((row) => row.workspace_id));
}
