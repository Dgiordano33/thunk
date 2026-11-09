import "server-only";
import type { Project, ProjectSummary } from "@/lib/projects/types";
import type { RepoFolder } from "@/lib/projects/types";
import { forgetRepoFolders, listAllRepoFolders, listRepoFolders } from "./repo-folders";
import { db } from "../server";
import { memForgetProject, memProjectRepos, PROJECT_REPO_COLUMNS, toProjectRepos, type ProjectRepoRow } from "./project-repos";
import { deleteTask, listTasks } from "./tasks";
import { emitTask } from "@/lib/tasks/events";

type Row = {
  id: string;
  name: string;
  data_key: string;
  created_at: string;
  updated_at: string;
  project_repos?: ProjectRepoRow[] | null;
};

const COLUMNS = `id, name, data_key, created_at, updated_at, project_repos(${PROJECT_REPO_COLUMNS})`;

function toProject(r: Row): Project {
  return {
    id: r.id,
    name: r.name,
    dataKey: r.data_key,
    repos: toProjectRepos(r.project_repos),
    repoFolders: [],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// Memory-only mode (no Supabase): projects live for the server's lifetime. Pinned to globalThis for HMR.
// Stored without repos; `withRepos` attaches the current list on every read.
const g = globalThis as typeof globalThis & { __thunkMemProjectsV2?: Map<string, Project> };
const mem = (g.__thunkMemProjectsV2 ??= new Map());
const withRepos = (p: Project): Project => ({ ...p, repos: memProjectRepos(p.id) });

/** Attach registered folders whose repo is still in the project. Pure: one query, no file reads or writes. */
const attachFolders = <T extends Project>(project: T, folders: RepoFolder[]): T => ({
  ...project,
  repoFolders: folders.filter((f) => project.repos.some((r) => r.id === f.repoId)),
});
const withRepoFolders = async <T extends Project>(project: T): Promise<T> => attachFolders(project, await listRepoFolders(project.id));

/** A new project with no repos. A taken data key is a Postgres-style unique violation (`code: "23505"`). */
export async function insertProject(input: { name: string; dataKey: string }): Promise<Project> {
  const client = db();
  if (!client) {
    if ([...mem.values()].some((p) => p.dataKey === input.dataKey)) throw Object.assign(new Error(`Data key taken: ${input.dataKey}`), { code: "23505" });
    const now = new Date().toISOString();
    const project: Project = { id: crypto.randomUUID(), ...input, repos: [], repoFolders: [], createdAt: now, updatedAt: now };
    mem.set(project.id, project);
    return withRepoFolders(withRepos(project));
  }
  const { data, error } = await client.from("projects").insert({ name: input.name, data_key: input.dataKey }).select(COLUMNS).single();
  if (error) throw error;
  return withRepoFolders(toProject(data));
}

/** The project with this data key, created if needed. An existing project keeps its name. */
export async function upsertProjectByKey(input: { name: string; dataKey: string }): Promise<Project> {
  const existing = await getProjectByKey(input.dataKey);
  if (existing) return existing;
  return insertProject(input).catch(async (err: { code?: string }) => {
    const raced = err.code === "23505" ? await getProjectByKey(input.dataKey) : null;
    if (!raced) throw err;
    return raced;
  });
}

export async function getProject(id: string): Promise<Project | null> {
  const client = db();
  if (!client) {
    const p = mem.get(id);
    return p ? withRepoFolders(withRepos(p)) : null;
  }
  const { data, error } = await client.from("projects").select(COLUMNS).eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? withRepoFolders(toProject(data)) : null;
}

export async function getProjectByKey(dataKey: string): Promise<Project | null> {
  const client = db();
  if (!client) {
    const p = [...mem.values()].find((p) => p.dataKey === dataKey);
    return p ? withRepoFolders(withRepos(p)) : null;
  }
  const { data, error } = await client.from("projects").select(COLUMNS).eq("data_key", dataKey).maybeSingle();
  if (error) throw error;
  return data ? withRepoFolders(toProject(data)) : null;
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
    memForgetProject(id);
    forgetRepoFolders(id);
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
  const folders = await listAllRepoFolders();
  const foldersOf = (p: Project) => attachFolders(p, folders.get(p.id) ?? []);
  if (!client) {
    return [...mem.values()]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((p) => ({ ...foldersOf(withRepos(p)), workspaceCount: 0, sessionCount: 0, lastActivityAt: null }));
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
    return { ...foldersOf(toProject(r as unknown as Row)), workspaceCount: ws.length, sessionCount, lastActivityAt: last };
  });
}
