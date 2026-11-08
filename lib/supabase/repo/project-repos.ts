import "server-only";
import type { ProjectRepo, WorkspaceRepo } from "@/lib/projects/types";
import { db } from "../server";

/**
 * Additional repos of multi-repo projects (project_repos) and each workspace's checkout of them
 * (workspace_repos). The primary repo stays on the projects / workspaces rows themselves.
 */

export type ProjectRepoRow = {
  id: string;
  project_id: string;
  name: string;
  path: string;
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

export const PROJECT_REPO_COLUMNS = "id, project_id, name, path, remote, default_branch, created_at";
/** Embeddable from workspaces: the repo's name comes along through the foreign key. */
export const WORKSPACE_REPO_COLUMNS = "repo_id, cwd, branch, worktree_path, base_ref, created_at, project_repos(name)";

export function toProjectRepo(r: ProjectRepoRow): ProjectRepo {
  return {
    id: r.id,
    projectId: r.project_id,
    name: r.name,
    path: r.path,
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

// Memory-only mode (no Supabase). Pinned to globalThis for HMR.
type MemWorkspaceRepo = Omit<WorkspaceRepo, "name"> & { workspaceId: string; createdAt: string };
const g = globalThis as typeof globalThis & {
  __thunkMemProjectRepos?: Map<string, ProjectRepo>;
  __thunkMemWorkspaceRepos?: MemWorkspaceRepo[];
};
const memRepos = (g.__thunkMemProjectRepos ??= new Map());
const memWsRepos = (g.__thunkMemWorkspaceRepos ??= []);

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
  const { data, error } = await client.from("project_repos").select(PROJECT_REPO_COLUMNS).eq("project_id", projectId);
  if (error) throw error;
  return toProjectRepos(data);
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
  const { data, error } = await client
    .from("project_repos")
    .insert({
      project_id: input.projectId,
      name: input.name,
      path: input.path,
      remote: input.remote,
      default_branch: input.defaultBranch,
    })
    .select(PROJECT_REPO_COLUMNS)
    .single();
  if (error) {
    if (error.code === "23505") throw new Error(`${input.name} (${input.path}) is already in this project`);
    throw error;
  }
  return toProjectRepo(data);
}

export async function deleteProjectRepo(id: string): Promise<void> {
  const client = db();
  if (!client) {
    memRepos.delete(id);
    return;
  }
  const { error } = await client.from("project_repos").delete().eq("id", id);
  if (error) throw error;
}

/** Every workspace checkout of one repo, so callers can refuse to drop a repo that still has worktrees. */
export async function listCheckoutsOfRepo(repoId: string): Promise<{ workspaceId: string; worktreePath: string | null }[]> {
  const client = db();
  if (!client) return memWsRepos.filter((r) => r.repoId === repoId).map((r) => ({ workspaceId: r.workspaceId, worktreePath: r.worktreePath }));
  const { data, error } = await client.from("workspace_repos").select("workspace_id, worktree_path").eq("repo_id", repoId);
  if (error) throw error;
  return data.map((r) => ({ workspaceId: r.workspace_id, worktreePath: r.worktree_path }));
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
  const { error } = await client.from("workspace_repos").insert(
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
  );
  if (error) throw error;
}

export async function deleteWorkspaceRepo(workspaceId: string, repoId: string): Promise<void> {
  const client = db();
  if (!client) {
    const i = memWsRepos.findIndex((r) => r.workspaceId === workspaceId && r.repoId === repoId);
    if (i >= 0) memWsRepos.splice(i, 1);
    return;
  }
  const { error } = await client.from("workspace_repos").delete().eq("workspace_id", workspaceId).eq("repo_id", repoId);
  if (error) throw error;
}
