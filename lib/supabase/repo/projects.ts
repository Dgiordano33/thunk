import "server-only";
import type { Project, ProjectSummary } from "@/lib/projects/types";
import { db } from "../server";
import { deleteTask, listTasks } from "./tasks";
import { emitTask } from "@/lib/tasks/events";

type Row = {
  id: string;
  name: string;
  root: string;
  kind: string;
  remote: string | null;
  default_branch: string | null;
  created_at: string;
  updated_at: string;
};

const COLUMNS = "id, name, root, kind, remote, default_branch, created_at, updated_at";

function toProject(r: Row): Project {
  return {
    id: r.id,
    name: r.name,
    root: r.root,
    kind: r.kind as Project["kind"],
    remote: r.remote,
    defaultBranch: r.default_branch,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// Memory-only mode (no Supabase): projects live for the server's lifetime. Pinned to globalThis for HMR.
const g = globalThis as typeof globalThis & { __thunkMemProjects?: Map<string, Project> };
const mem = (g.__thunkMemProjects ??= new Map());

export async function upsertProject(input: Omit<Project, "id" | "createdAt" | "updatedAt">): Promise<Project> {
  const client = db();
  const now = new Date().toISOString();
  if (!client) {
    const existing = [...mem.values()].find((p) => p.root === input.root);
    const project: Project = existing
      ? { ...existing, ...input, updatedAt: now }
      : { id: crypto.randomUUID(), ...input, createdAt: now, updatedAt: now };
    mem.set(project.id, project);
    return project;
  }
  const { data, error } = await client
    .from("projects")
    .upsert(
      {
        name: input.name,
        root: input.root,
        kind: input.kind,
        remote: input.remote,
        default_branch: input.defaultBranch,
        updated_at: now,
      },
      { onConflict: "root" },
    )
    .select(COLUMNS)
    .single();
  if (error) throw error;
  return toProject(data);
}

export async function getProject(id: string): Promise<Project | null> {
  const client = db();
  if (!client) return mem.get(id) ?? null;
  const { data, error } = await client.from("projects").select(COLUMNS).eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? toProject(data) : null;
}

export async function getProjectByRoot(root: string): Promise<Project | null> {
  const client = db();
  if (!client) return [...mem.values()].find((p) => p.root === root) ?? null;
  const { data, error } = await client.from("projects").select(COLUMNS).eq("root", root).maybeSingle();
  if (error) throw error;
  return data ? toProject(data) : null;
}

export async function updateProject(id: string, patch: { name?: string }): Promise<void> {
  const client = db();
  if (!client) {
    const p = mem.get(id);
    if (p) mem.set(id, { ...p, ...patch, updatedAt: new Date().toISOString() });
    return;
  }
  const { error } = await client.from("projects").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteProject(id: string): Promise<void> {
  const client = db();
  if (!client) {
    for (const task of await listTasks({ projectId: id })) await deleteTask(task.id);
    mem.delete(id);
    return;
  }
  const tasks = await listTasks({ projectId: id });
  const { error } = await client.from("projects").delete().eq("id", id);
  if (error) throw error;
  for (const task of tasks) emitTask({ projectId: task.projectId, workspaceId: task.workspaceId, taskId: task.id, kind: "removed" });
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const client = db();
  if (!client) {
    return [...mem.values()]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((p) => ({ ...p, workspaceCount: 0, sessionCount: 0, lastActivityAt: null }));
  }
  const { data, error } = await client
    .from("projects")
    .select(`${COLUMNS}, workspaces(id, updated_at, sessions(count))`)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data.map((r) => {
    const ws = (r.workspaces ?? []) as unknown as { id: string; updated_at: string; sessions: { count: number }[] }[];
    const last = ws.map((w) => w.updated_at).sort().at(-1) ?? null;
    const sessionCount = ws.reduce((n, w) => n + (w.sessions[0]?.count ?? 0), 0);
    return { ...toProject(r), workspaceCount: ws.length, sessionCount, lastActivityAt: last };
  });
}
