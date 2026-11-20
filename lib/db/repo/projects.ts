import "server-only";
import type { Project, ProjectSummary } from "@/lib/projects/types";
import type { RepoFolder } from "@/lib/projects/types";
import { forgetRepoFolders, listAllRepoFolders, listRepoFolders } from "./repo-folders";
import { db } from "../server";
import { memForgetProject, memProjectRepos, PROJECT_REPOS_JSON, toProjectRepos, type ProjectRepoRow } from "./project-repos";
import { insertSql, run, updateSql } from "../sql";
import { deleteTask, listTasks } from "./tasks";
import { emitTask } from "@/lib/tasks/events";
import { HOME_DATA_KEY } from "@/lib/home/constants";

type Row = {
  id: string;
  name: string;
  data_key: string;
  slug: string;
  created_at: string;
  updated_at: string;
  project_repos?: ProjectRepoRow[] | null;
};

const SELECT = `select p.id, p.name, p.data_key, p.slug, p.created_at, p.updated_at, ${PROJECT_REPOS_JSON} from projects p`;

function toProject(r: Row): Project {
  return {
    id: r.id,
    name: r.name,
    dataKey: r.data_key,
    slug: r.slug,
    repos: toProjectRepos(r.project_repos),
    repoFolders: [],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// Memory-only mode (THUNK_DATABASE=memory, or the embedded database is held by another process): projects live for the server's lifetime. Pinned to globalThis for HMR.
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

async function findOne(where: string, value: string): Promise<Project | null> {
  const [row] = await db()!.query<Row>(`${SELECT} where ${where}`, [value]);
  return row ? withRepoFolders(toProject(row)) : null;
}

/** A new project with no repos. A taken data key or slug is a Postgres-style unique violation (`code: "23505"`). */
export async function insertProject(input: { name: string; dataKey: string; slug: string }): Promise<Project> {
  const client = db();
  if (!client) {
    if ([...mem.values()].some((p) => p.dataKey === input.dataKey)) throw Object.assign(new Error(`Data key taken: ${input.dataKey}`), { code: "23505" });
    if ([...mem.values()].some((p) => p.slug === input.slug)) throw Object.assign(new Error(`Slug taken: ${input.slug}`), { code: "23505" });
    const now = new Date().toISOString();
    const project: Project = { id: crypto.randomUUID(), ...input, repos: [], repoFolders: [], createdAt: now, updatedAt: now };
    mem.set(project.id, project);
    return withRepoFolders(withRepos(project));
  }
  const [{ id }] = await run<{ id: string }>(client, insertSql("projects", { name: input.name, data_key: input.dataKey, slug: input.slug }, { returning: "id" }));
  return (await getProject(id))!;
}

/** The project with this data key, created if needed. An existing project keeps its name and slug. */
export async function upsertProjectByKey(input: { name: string; dataKey: string; slug: string }): Promise<Project> {
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
  return findOne("p.id = $1", id);
}

export async function getProjectByKey(dataKey: string): Promise<Project | null> {
  const client = db();
  if (!client) {
    const p = [...mem.values()].find((p) => p.dataKey === dataKey);
    return p ? withRepoFolders(withRepos(p)) : null;
  }
  return findOne("p.data_key = $1", dataKey);
}

/** The project at `/{slug}`. */
export async function getProjectBySlug(slug: string): Promise<Project | null> {
  const client = db();
  if (!client) {
    const p = [...mem.values()].find((p) => p.slug === slug);
    return p ? withRepoFolders(withRepos(p)) : null;
  }
  return findOne("p.slug = $1", slug);
}

export async function updateProject(id: string, patch: { name?: string }): Promise<void> {
  const client = db();
  if (!client) {
    const p = mem.get(id);
    if (p) mem.set(id, { ...p, ...patch, updatedAt: new Date().toISOString() });
    return;
  }
  const statement = updateSql("projects", patch, "id = $1", [id]);
  if (statement) await run(client, statement);
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
  await client.query("delete from projects where id = $1", [id]);
  for (const task of tasks) emitTask({ projectId: task.projectId, workspaceId: task.workspaceId, taskId: task.id, kind: "removed" });
}

/** Every project, newest activity first. The internal Home project is left out unless asked for. */
export async function listProjects({ includeHome = false }: { includeHome?: boolean } = {}): Promise<ProjectSummary[]> {
  return (await listAllProjects()).filter((p) => includeHome || p.dataKey !== HOME_DATA_KEY);
}

async function listAllProjects(): Promise<ProjectSummary[]> {
  const client = db();
  const folders = await listAllRepoFolders();
  const foldersOf = (p: Project) => attachFolders(p, folders.get(p.id) ?? []);
  if (!client) {
    return [...mem.values()]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((p) => ({ ...foldersOf(withRepos(p)), workspaceCount: 0, sessionCount: 0, lastActivityAt: null }));
  }
  const rows = await client.query<Row & { workspace_count: number; session_count: number; last_activity_at: string | null }>(
    `select p.id, p.name, p.data_key, p.slug, p.created_at, p.updated_at, ${PROJECT_REPOS_JSON},
      (select count(*) from workspaces w where w.project_id = p.id) as workspace_count,
      (select count(*) from sessions s join workspaces w on w.id = s.workspace_id where w.project_id = p.id) as session_count,
      (select max(w.updated_at) from workspaces w where w.project_id = p.id) as last_activity_at
    from projects p order by p.updated_at desc`,
  );
  return rows.map((r) => ({
    ...foldersOf(toProject(r)),
    workspaceCount: r.workspace_count,
    sessionCount: r.session_count,
    lastActivityAt: r.last_activity_at,
  }));
}
