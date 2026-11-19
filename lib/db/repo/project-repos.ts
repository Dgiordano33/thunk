import "server-only";
import type { ProjectRepo, WorkspaceRepo } from "@/lib/projects/types";
import { forgetRepoFolders } from "./repo-folders";
import { db } from "../server";
import { embed, insertSql, run, updateSql } from "../sql";

/**
 * The repos and folders a project spans (project_repos) and each workspace's checkout of them
 * (workspace_repos).
 */

export type ProjectRepoRow = {
  id: string;
  project_id: string;
  name: string;
  path: string;
  kind: string;
  remote: string | null;
  default_branch: string | null;
  created_at: string;
};

export type WorkspaceRepoRow = {
  repo_id: string;
  cwd: string;
  branch: string | null;
  worktree_path: string | null;
  base_ref: string | null;
  created_at: string;
  project_repos: { name: string } | null;
};

export const PROJECT_REPO_COLUMNS = "id, project_id, name, path, kind, remote, default_branch, created_at";
/** A project's repos as a JSON column, for queries aliasing projects as `p`. */
export const PROJECT_REPOS_JSON = `${embed(PROJECT_REPO_COLUMNS, "project_repos", "project_id = p.id")} as project_repos`;
/** A workspace's repo checkouts, with each repo's name, as a JSON column, for queries aliasing workspaces as `w`. */
export const WORKSPACE_REPOS_JSON = `${embed(
  "wr.repo_id, wr.cwd, wr.branch, wr.worktree_path, wr.base_ref, wr.created_at, json_build_object('name', pr.name) as project_repos",
  "workspace_repos wr left join project_repos pr on pr.id = wr.repo_id",
  "wr.workspace_id = w.id",
)} as workspace_repos`;

export function toProjectRepo(r: ProjectRepoRow): ProjectRepo {
  return {
    id: r.id,
    projectId: r.project_id,
    name: r.name,
    path: r.path,
    kind: r.kind as ProjectRepo["kind"],
    remote: r.remote,
    defaultBranch: r.default_branch,
    createdAt: r.created_at,
  };
}

export function toProjectRepos(rows: ProjectRepoRow[] | null | undefined): ProjectRepo[] {
  return [...(rows ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at)).map(toProjectRepo);
}

export function toWorkspaceRepos(rows: WorkspaceRepoRow[] | null | undefined): WorkspaceRepo[] {
  return [...(rows ?? [])]
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((r) => ({
      repoId: r.repo_id,
      name: r.project_repos?.name ?? "repo",
      cwd: r.cwd,
      branch: r.branch,
      worktreePath: r.worktree_path,
      baseRef: r.base_ref,
    }));
}

// Memory-only mode (THUNK_DATABASE=memory, or the embedded database is held by another process). Pinned to globalThis for HMR.
type MemWorkspaceRepo = Omit<WorkspaceRepo, "name"> & { workspaceId: string; createdAt: string };
const g = globalThis as typeof globalThis & {
  __thunkMemProjectReposV2?: Map<string, ProjectRepo>;
  __thunkMemWorkspaceReposV2?: MemWorkspaceRepo[];
};
const memRepos = (g.__thunkMemProjectReposV2 ??= new Map());
const memWsRepos = (g.__thunkMemWorkspaceReposV2 ??= []);

/** Memory mode: a project's repos, oldest first. */
export function memProjectRepos(projectId: string): ProjectRepo[] {
  return [...memRepos.values()].filter((r) => r.projectId === projectId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Memory mode: a workspace's repo checkouts, oldest first. */
export function memWorkspaceRepos(workspaceId: string): WorkspaceRepo[] {
  return memWsRepos
    .filter((r) => r.workspaceId === workspaceId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((r) => ({
      repoId: r.repoId,
      name: memRepos.get(r.repoId)?.name ?? "repo",
      cwd: r.cwd,
      branch: r.branch,
      worktreePath: r.worktreePath,
      baseRef: r.baseRef,
    }));
}

/** Memory mode cascade, mirroring the foreign keys. */
export function memForgetProject(projectId: string) {
  for (const r of memProjectRepos(projectId)) memRepos.delete(r.id);
}
export function memForgetWorkspace(workspaceId: string) {
  for (let i = memWsRepos.length - 1; i >= 0; i--) if (memWsRepos[i].workspaceId === workspaceId) memWsRepos.splice(i, 1);
}

export async function listProjectRepos(projectId: string): Promise<ProjectRepo[]> {
  const client = db();
  if (!client) return memProjectRepos(projectId);
  return toProjectRepos(await client.query<ProjectRepoRow>(`select ${PROJECT_REPO_COLUMNS} from project_repos where project_id = $1`, [projectId]));
}

export async function insertProjectRepo(input: Omit<ProjectRepo, "id" | "createdAt">): Promise<ProjectRepo> {
  const client = db();
  if (!client) {
    const existing = memProjectRepos(input.projectId);
    if (existing.some((r) => r.path === input.path)) throw new Error(`${input.path} is already in this project`);
    if (existing.some((r) => r.name === input.name)) throw new Error(`A repo named ${input.name} is already in this project`);
    const repo: ProjectRepo = { id: crypto.randomUUID(), ...input, createdAt: new Date().toISOString() };
    memRepos.set(repo.id, repo);
    return repo;
  }
  try {
    const [row] = await run<ProjectRepoRow>(client, insertSql("project_repos", {
      project_id: input.projectId,
      name: input.name,
      path: input.path,
      kind: input.kind,
      remote: input.remote,
      default_branch: input.defaultBranch,
    }, { returning: PROJECT_REPO_COLUMNS }));
    return toProjectRepo(row);
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw new Error(`${input.name} (${input.path}) is already in this project`);
    throw error;
  }
}

/** Refresh what git says about a repo that is already registered. */
export async function updateProjectRepo(id: string, patch: Pick<ProjectRepo, "kind" | "remote" | "defaultBranch">): Promise<void> {
  const client = db();
  if (!client) {
    const repo = memRepos.get(id);
    if (repo) memRepos.set(id, { ...repo, ...patch });
    return;
  }
  const statement = updateSql("project_repos", { kind: patch.kind, remote: patch.remote, default_branch: patch.defaultBranch }, "id = $1", [id]);
  if (statement) await run(client, statement);
}

/** The project that first registered a checkout, for finding a project from a directory. */
export async function findProjectIdByRepoPath(repoPath: string): Promise<string | null> {
  const client = db();
  if (!client) return [...memRepos.values()].filter((r) => r.path === repoPath).sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]?.projectId ?? null;
  const [row] = await client.query<{ project_id: string }>("select project_id from project_repos where path = $1 order by created_at limit 1", [repoPath]);
  return row?.project_id ?? null;
}

export async function deleteProjectRepo(id: string): Promise<void> {
  const client = db();
  if (!client) {
    const repo = memRepos.get(id);
    if (repo) forgetRepoFolders(repo.projectId, id);
    memRepos.delete(id);
    return;
  }
  await client.query("delete from project_repos where id = $1", [id]);
}

/** Every workspace checkout of one repo, so callers can refuse to drop a repo that still has worktrees. */
export async function listCheckoutsOfRepo(repoId: string): Promise<{ workspaceId: string; worktreePath: string | null }[]> {
  const client = db();
  if (!client) return memWsRepos.filter((r) => r.repoId === repoId).map((r) => ({ workspaceId: r.workspaceId, worktreePath: r.worktreePath }));
  const rows = await client.query<{ workspace_id: string; worktree_path: string | null }>("select workspace_id, worktree_path from workspace_repos where repo_id = $1", [repoId]);
  return rows.map((r) => ({ workspaceId: r.workspace_id, worktreePath: r.worktree_path }));
}

export async function insertWorkspaceRepos(workspaceId: string, rows: Omit<WorkspaceRepo, "name">[]): Promise<void> {
  if (!rows.length) return;
  const client = db();
  if (!client) {
    const now = Date.now();
    rows.forEach((r, i) => memWsRepos.push({ ...r, workspaceId, createdAt: new Date(now + i).toISOString() }));
    return;
  }
  const now = Date.now();
  await run(client, insertSql(
    "workspace_repos",
    rows.map((r, i) => ({
      workspace_id: workspaceId,
      repo_id: r.repoId,
      cwd: r.cwd,
      branch: r.branch,
      worktree_path: r.worktreePath,
      base_ref: r.baseRef,
      // Keeps the order repos were listed in, which is the order agents and the UI show them.
      created_at: new Date(now + i).toISOString(),
    })),
  ));
}

export async function deleteWorkspaceRepo(workspaceId: string, repoId: string): Promise<void> {
  const client = db();
  if (!client) {
    const i = memWsRepos.findIndex((r) => r.workspaceId === workspaceId && r.repoId === repoId);
    if (i >= 0) memWsRepos.splice(i, 1);
    return;
  }
  await client.query("delete from workspace_repos where workspace_id = $1 and repo_id = $2", [workspaceId, repoId]);
}
