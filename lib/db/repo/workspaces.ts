import "server-only";
import type { Workspace, WorkspaceSummary } from "@/lib/projects/types";
import { db } from "../server";
import { memForgetWorkspace, memWorkspaceRepos, toWorkspaceRepos, WORKSPACE_REPOS_JSON, type WorkspaceRepoRow } from "./project-repos";
import { insertSql, run, updateSql } from "../sql";
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

const COLUMNS = `w.id, w.project_id, w.name, w.slug, w.cwd, w.branch, w.status, w.created_at, w.updated_at, ${WORKSPACE_REPOS_JSON}`;

async function findOne(where: string, params: unknown[]): Promise<Workspace | null> {
  const [row] = await db()!.query<Row>(`select ${COLUMNS} from workspaces w where ${where} order by w.created_at limit 1`, params);
  return row ? toWorkspace(row) : null;
}

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

// Memory-only mode (THUNK_DATABASE=memory, or the embedded database is held by another process): workspaces live for the server's lifetime. Pinned to globalThis for HMR.
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
  const [{ id }] = await run<{ id: string }>(client, insertSql("workspaces", {
    id: input.id,
    project_id: input.projectId,
    name: input.name,
    slug: input.slug,
    cwd: input.cwd,
    branch: input.branch,
  }, { returning: "id" }));
  return (await getWorkspace(id))!;
}

export async function getWorkspace(id: string): Promise<Workspace | null> {
  const client = db();
  if (!client) {
    const w = mem.get(id);
    return w ? withRepos(w) : null;
  }
  return findOne("w.id = $1", [id]);
}

export async function findWorkspace(projectId: string, by: { slug?: string; cwd?: string }): Promise<Workspace | null> {
  const client = db();
  if (!client) {
    const found = [...mem.values()].find(
      (w) => w.projectId === projectId && (by.slug ? w.slug === by.slug : true) && (by.cwd ? w.cwd === by.cwd : true),
    );
    return found ? withRepos(found) : null;
  }
  const where = ["w.project_id = $1"];
  const params: unknown[] = [projectId];
  if (by.slug) { params.push(by.slug); where.push(`w.slug = $${params.length}`); }
  if (by.cwd) { params.push(by.cwd); where.push(`w.cwd = $${params.length}`); }
  return findOne(where.join(" and "), params);
}

/** The oldest workspace running in a directory, across projects. A project's main workspace is its oldest. */
export async function findWorkspaceByCwd(cwd: string): Promise<Workspace | null> {
  const client = db();
  if (!client) {
    const found = [...mem.values()].filter((w) => w.cwd === cwd).sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    return found ? withRepos(found) : null;
  }
  return findOne("w.cwd = $1", [cwd]);
}

export async function updateWorkspace(id: string, patch: Partial<Pick<Workspace, "name" | "status" | "cwd">>): Promise<void> {
  const client = db();
  if (!client) {
    const w = mem.get(id);
    if (w) mem.set(id, { ...w, ...patch, updatedAt: new Date().toISOString() });
    return;
  }
  const statement = updateSql("workspaces", patch, "id = $1", [id]);
  if (statement) await run(client, statement);
}

/** Bump updated_at so "last activity" ordering reflects session traffic. */
export async function touchWorkspace(id: string): Promise<void> {
  const client = db();
  if (!client) {
    const w = mem.get(id);
    if (w) mem.set(id, { ...w, updatedAt: new Date().toISOString() });
    return;
  }
  await client.query("update workspaces set updated_at = now() where id = $1", [id]).catch((err) => console.error("[thunk] touch workspace failed", err));
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
  await client.query("delete from workspaces where id = $1", [id]);
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
  const rows = await client.query<Row & { session_count: number }>(
    `select ${COLUMNS}, (select count(*) from sessions s where s.workspace_id = w.id) as session_count from workspaces w` +
      `${projectId !== null ? " where w.project_id = $1" : ""} order by w.updated_at desc`,
    projectId !== null ? [projectId] : [],
  );
  return rows.map((r) => ({ ...toWorkspace(r), sessionCount: r.session_count }));
}
