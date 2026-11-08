import "server-only";
import type { Workspace, WorkspaceSummary } from "@/lib/projects/types";
import { db } from "../server";

type Row = {
  id: string;
  project_id: string;
  name: string;
  slug: string;
  cwd: string;
  branch: string | null;
  worktree_path: string | null;
  base_ref: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

const COLUMNS = "id, project_id, name, slug, cwd, branch, worktree_path, base_ref, status, created_at, updated_at";

function toWorkspace(r: Row): Workspace {
  return {
    id: r.id,
    projectId: r.project_id,
    name: r.name,
    slug: r.slug,
    cwd: r.cwd,
    branch: r.branch,
    worktreePath: r.worktree_path,
    baseRef: r.base_ref,
    status: r.status as Workspace["status"],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// Memory-only mode (no Supabase): workspaces live for the server's lifetime. Pinned to globalThis for HMR.
const g = globalThis as typeof globalThis & { __thunkMemWorkspaces?: Map<string, Workspace> };
const mem = (g.__thunkMemWorkspaces ??= new Map());

export async function insertWorkspace(
  input: Omit<Workspace, "id" | "createdAt" | "updatedAt" | "status"> & { id?: string },
): Promise<Workspace> {
  const client = db();
  const now = new Date().toISOString();
  if (!client) {
    const ws: Workspace = { id: input.id ?? crypto.randomUUID(), ...input, status: "active", createdAt: now, updatedAt: now };
    mem.set(ws.id, ws);
    return ws;
  }
  const { data, error } = await client
    .from("workspaces")
    .insert({
      ...(input.id ? { id: input.id } : {}),
      project_id: input.projectId,
      name: input.name,
      slug: input.slug,
      cwd: input.cwd,
      branch: input.branch,
      worktree_path: input.worktreePath,
      base_ref: input.baseRef,
    })
    .select(COLUMNS)
    .single();
  if (error) throw error;
  return toWorkspace(data);
}

export async function getWorkspace(id: string): Promise<Workspace | null> {
  const client = db();
  if (!client) return mem.get(id) ?? null;
  const { data, error } = await client.from("workspaces").select(COLUMNS).eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? toWorkspace(data) : null;
}

export async function findWorkspace(projectId: string, by: { slug?: string; cwd?: string }): Promise<Workspace | null> {
  const client = db();
  if (!client) {
    return (
      [...mem.values()].find(
        (w) => w.projectId === projectId && (by.slug ? w.slug === by.slug : true) && (by.cwd ? w.cwd === by.cwd : true),
      ) ?? null
    );
  }
  let q = client.from("workspaces").select(COLUMNS).eq("project_id", projectId);
  if (by.slug) q = q.eq("slug", by.slug);
  if (by.cwd) q = q.eq("cwd", by.cwd);
  const { data, error } = await q.order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (error) throw error;
  return data ? toWorkspace(data) : null;
}

export async function updateWorkspace(id: string, patch: Partial<Pick<Workspace, "name" | "status">>): Promise<void> {
  const client = db();
  if (!client) {
    const w = mem.get(id);
    if (w) mem.set(id, { ...w, ...patch, updatedAt: new Date().toISOString() });
    return;
  }
  const { error } = await client.from("workspaces").update(patch).eq("id", id);
  if (error) throw error;
}

/** Bump updated_at so "last activity" ordering reflects session traffic. */
export async function touchWorkspace(id: string): Promise<void> {
  const client = db();
  if (!client) {
    const w = mem.get(id);
    if (w) mem.set(id, { ...w, updatedAt: new Date().toISOString() });
    return;
  }
  await client.from("workspaces").update({ updated_at: new Date().toISOString() }).eq("id", id);
}

export async function deleteWorkspace(id: string): Promise<void> {
  const client = db();
  if (!client) {
    mem.delete(id);
    return;
  }
  const { error } = await client.from("workspaces").delete().eq("id", id);
  if (error) throw error;
}

export async function listWorkspaces(projectId: string): Promise<WorkspaceSummary[]> {
  return queryWorkspaces(projectId);
}

/** Every workspace across all projects in one query, for views that list the whole tree. */
export async function listAllWorkspaces(): Promise<WorkspaceSummary[]> {
  return queryWorkspaces(null);
}

async function queryWorkspaces(projectId: string | null): Promise<WorkspaceSummary[]> {
  const client = db();
  if (!client) {
    return [...mem.values()]
      .filter((w) => projectId === null || w.projectId === projectId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((w) => ({ ...w, sessionCount: 0 }));
  }
  // sessions(count) aggregates in Postgres instead of shipping every session row.
  let q = client.from("workspaces").select(`${COLUMNS}, sessions(count)`).order("updated_at", { ascending: false });
  if (projectId !== null) q = q.eq("project_id", projectId);
  const { data, error } = await q;
  if (error) throw error;
  return data.map((r) => ({
    ...toWorkspace(r),
    sessionCount: (r.sessions as unknown as { count: number }[])[0]?.count ?? 0,
  }));
}
