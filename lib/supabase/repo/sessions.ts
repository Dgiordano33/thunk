import "server-only";
import type { SessionMeta, SessionState } from "@/lib/agent/types";
import type { TablesUpdate } from "../types";
import { db } from "../server";

export type SessionRow = Omit<SessionMeta, "live"> & { workspaceId: string; totalCostUsd: number; updatedAt: string };

type Row = {
  id: string;
  workspace_id: string;
  sdk_session_id: string | null;
  title: string | null;
  cwd: string;
  model: string;
  permission_mode: string;
  status: string;
  total_cost_usd: number;
  created_at: string;
  updated_at: string;
};

const COLUMNS =
  "id, workspace_id, sdk_session_id, title, cwd, model, permission_mode, status, total_cost_usd, created_at, updated_at";

function toSession(r: Row): SessionRow {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    sdkSessionId: r.sdk_session_id,
    title: r.title,
    cwd: r.cwd,
    model: r.model,
    permissionMode: r.permission_mode,
    status: r.status as SessionState,
    totalCostUsd: Number(r.total_cost_usd),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function upsertSession(meta: Omit<SessionMeta, "live">, workspaceId: string) {
  const client = db();
  if (!client) return;
  const { error } = await client.from("sessions").upsert(
    {
      id: meta.id,
      workspace_id: workspaceId,
      sdk_session_id: meta.sdkSessionId ?? null,
      title: meta.title ?? null,
      cwd: meta.cwd,
      model: meta.model,
      permission_mode: meta.permissionMode,
      status: meta.status,
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
  return data ? toSession(data) : null;
}

export async function listSessionRows(opts: { workspaceId?: string; cwd?: string; limit?: number } = {}) {
  const client = db();
  if (!client) return [];
  let q = client.from("sessions").select(COLUMNS).order("updated_at", { ascending: false }).limit(opts.limit ?? 50);
  if (opts.workspaceId) q = q.eq("workspace_id", opts.workspaceId);
  if (opts.cwd) q = q.eq("cwd", opts.cwd);
  const { data, error } = await q;
  if (error) throw error;
  return data.map(toSession);
}
