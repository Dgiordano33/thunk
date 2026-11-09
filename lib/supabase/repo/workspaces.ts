import "server-only";
import type { Workspace, WorkspaceSummary } from "@/lib/projects/types";
import { db } from "../server";
import { memForgetWorkspace, memWorkspaceRepos, toWorkspaceRepos, WORKSPACE_REPO_COLUMNS, type WorkspaceRepoRow } from "./project-repos";
import { deleteTask, listTasks } from "./tasks";
import { emitTask } from "@/lib/tasks/events";

type Row = {
  id: string;
  project_id: string;
  name: string;
  slug: string;
  cwd: string;
  branch: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  workspace_repos?: WorkspaceRepoRow[] | null;
};

const COLUMNS = `id, project_id, name, slug, cwd, branch, status, created_at, updated_at, workspace_repos(${WORKSPACE_REPO_COLUMNS})`;

function toWorkspace(r: Row): Workspace {
  return {
    id: r.id,
    projectId: r.project_id,
    name: r.name,
    slug: r.slug,
    cwd: r.cwd,
    branch: r.branch,
    repos: toWorkspaceRepos(r.workspace_repos),
    status: r.status as Workspace["status"],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// Memory-only mode (no Supabase): workspaces live for the server's lifetime. Pinned to globalThis for HMR.
// Stored without repos; `withRepos` attaches the current list on every read.
const g = globalThis as typeof globalThis & { __thunkMemWorkspacesV2?: Map<string, Workspace> };
const mem = (g.__thunkMemWorkspacesV2 ??= new Map());
const withRepos = (w: Workspace): Workspace => ({ ...w, repos: memWorkspaceRepos(w.id) });

/** Insert the workspace row. Its repo checkouts are added separately with insertWorkspaceRepos. */
export async function insertWorkspace(
  input: Omit<Workspace, "id" | "createdAt" | "updatedAt" | "status" | "repos"> & { id?: string },
): Promise<Workspace> {
  const client = db();
  const now = new Date().toISOString();
  if (!client) {
    const ws: Workspace = { id: input.id ?? crypto.randomUUID(), ...input, repos: [], status: "active", createdAt: now, updatedAt: now };
    mem.set(ws.id, ws);
    return withRepos(ws);
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
    })
    .select(COLUMNS)
    .single();
  if (error) throw error;
  return toWorkspace(data);
}

export async function getWorkspace(id: string): Promise<Workspace | null> {
  const client = db();
  if (!client) {
    const w = mem.get(id);
    return w ? withRepos(w) : null;
  }
  const { data, error } = await client.from("workspaces").select(COLUMNS).eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? toWorkspace(data) : null;
}

export async function findWorkspace(projectId: string, by: { slug?: string; cwd?: string }): Promise<Workspace | null> {
  const client = db();
  if (!client) {
    const found = [...mem.values()].find(
      (w) => w.projectId === projectId && (by.slug ? w.slug === by.slug : true) && (by.cwd ? w.cwd === by.cwd : true),
    );
    return found ? withRepos(found) : null;
  }
  let q = client.from("workspaces").select(COLUMNS).eq("project_id", projectId);
  if (by.slug) q = q.eq("slug", by.slug);
  if (by.cwd) q = q.eq("cwd", by.cwd);
  const { data, error } = await q.order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (error) throw error;
  return data ? toWorkspace(data) : null;
}

/** The oldest workspace running in a directory, across projects. A project's main workspace is its oldest. */
export async function findWorkspaceByCwd(cwd: string): Promise<Workspace | null> {
  const client = db();
  if (!client) {
    const found = [...mem.values()].filter((w) => w.cwd === cwd).sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    return found ? withRepos(found) : null;
  }
  const { data, error } = await client.from("workspaces").select(COLUMNS).eq("cwd", cwd).order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (error) throw error;
  return data ? toWorkspace(data) : null;
}

export async function updateWorkspace(id: string, patch: Partial<Pick<Workspace, "name" | "status" | "cwd">>): Promise<void> {
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
    for (const task of await listTasks({ workspaceId: id })) await deleteTask(task.id);
    memForgetWorkspace(id);
    mem.delete(id);
    return;
  }
  const tasks = await listTasks({ workspaceId: id });
  const { error } = await client.from("workspaces").delete().eq("id", id);
  if (error) throw error;
  for (const task of tasks) emitTask({ projectId: task.projectId, workspaceId: task.workspaceId, taskId: task.id, kind: "removed" });
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
      .map((w) => ({ ...withRepos(w), sessionCount: 0 }));
  }
  // sessions(count) aggregates in Postgres instead of shipping every session row.
  let q = client.from("workspaces").select(`${COLUMNS}, sessions(count)`).order("updated_at", { ascending: false });
  if (projectId !== null) q = q.eq("project_id", projectId);
  const { data, error } = await q;
  if (error) throw error;
  return data.map((r) => ({
    ...toWorkspace(r as unknown as Row),
    sessionCount: (r.sessions as unknown as { count: number }[])[0]?.count ?? 0,
  }));
}
