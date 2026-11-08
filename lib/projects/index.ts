import "server-only";
import { listSessions as sdkListSessions } from "@anthropic-ai/claude-agent-sdk";
import { rm } from "node:fs/promises";
import path from "node:path";
import { getProject, getProjectByRoot, upsertProject } from "@/lib/supabase/repo/projects";
import {
  deleteProjectRepo,
  deleteWorkspaceRepo,
  insertProjectRepo,
  insertWorkspaceRepos,
  listCheckoutsOfRepo,
} from "@/lib/supabase/repo/project-repos";
import {
  deleteWorkspace as deleteWorkspaceRow,
  findWorkspace,
  getWorkspace,
  insertWorkspace,
  listWorkspaces,
} from "@/lib/supabase/repo/workspaces";
import { createWorktree, detectProject, pickBaseRef, removeWorktree, resolveDirectory } from "./git";
import { ensureMemory } from "./memory";
import { projectMemoryFile, slugify, workspaceMemoryDir, workspaceMemoryFile, worktreePath } from "./paths";
import { prepareWorkspace, archiveWorkspaceProcesses, withWorkspaceLock, forgetWorkspaceRuntime, stopWorkspaceProcesses } from "./runtime";
import { assertWorkspaceCanRemove } from "./workspace-git";
import type { Project, ProjectRepo, Workspace, WorkspaceRepo } from "./types";

export type WorkspaceContext = { project: Project; workspace: Workspace };

/** Register (or refresh) the project that contains `input`. Idempotent per root. */
export async function addProject(input: string): Promise<Project> {
  const detected = await detectProject(input);
  const project = await upsertProject(detected);
  await ensureMemory(projectMemoryFile(project.root), `# ${project.name} — project memory`);
  return project;
}

/** The in-place workspace every project has: works directly in the root (and each extra repo), no worktrees. */
export async function ensureMainWorkspace(project: Project): Promise<Workspace> {
  const existing = await findWorkspace(project.id, { slug: "main" });
  if (existing) return existing;
  const ws = await insertWorkspace({
    projectId: project.id,
    name: "main",
    slug: "main",
    cwd: project.root,
    branch: null,
    worktreePath: null,
    baseRef: null,
  });
  await insertWorkspaceRepos(ws.id, project.extraRepos.map(inPlace));
  await ensureMemory(workspaceMemoryFile(project.root, ws.slug), `# ${project.name}/${ws.name} — workspace memory`);
  return (await getWorkspace(ws.id)) ?? ws;
}

/** A workspace checkout that works directly in the repo's main checkout. */
const inPlace = (repo: ProjectRepo): Omit<WorkspaceRepo, "name"> => ({
  repoId: repo.id,
  cwd: repo.path,
  branch: null,
  worktreePath: null,
  baseRef: null,
});

/**
 * Add another git repo to a project, from a path inside it (any worktree resolves to the main checkout).
 * The main workspace starts working on it in place; existing branch workspaces are left as they are.
 */
export async function addProjectRepo(projectId: string, input: string, opts: { name?: string } = {}): Promise<ProjectRepo> {
  const project = await getProject(projectId);
  if (!project) throw new Error("Project not found");
  const detected = await detectProject(input);
  if (detected.kind !== "repo") throw new Error(`Not a git repository: ${detected.root}`);
  if (detected.root === project.root) throw new Error("That repo is already the project's primary repo");
  const repo = await insertProjectRepo({
    projectId,
    name: opts.name?.trim() || detected.name,
    path: detected.root,
    remote: detected.remote,
    defaultBranch: detected.defaultBranch,
  });
  const main = await findWorkspace(projectId, { slug: "main" });
  if (main) await insertWorkspaceRepos(main.id, [inPlace(repo)]);
  return repo;
}

/**
 * Drop a repo from the project. Refuses while any workspace still has a worktree of it (remove those
 * workspaces first); in-place checkouts are simply forgotten. Nothing on disk is touched.
 */
export async function removeProjectRepo(projectId: string, repoId: string) {
  const project = await getProject(projectId);
  const repo = project?.extraRepos.find((r) => r.id === repoId);
  if (!project || !repo) throw new Error("Repo not found in this project");
  const checkouts = await listCheckoutsOfRepo(repoId);
  const worktrees = checkouts.filter((c) => c.worktreePath);
  if (worktrees.length) {
    const names = await Promise.all(worktrees.map(async (c) => (await getWorkspace(c.workspaceId))?.name ?? c.workspaceId));
    throw new Error(`${repo.name} still has worktrees in: ${names.join(", ")}. Remove those workspaces first.`);
  }
  for (const c of checkouts) await deleteWorkspaceRepo(c.workspaceId, repoId);
  await deleteProjectRepo(repoId);
}

export type CreateWorkspaceInput = {
  projectId: string;
  /** Defaults to an unused city name, Conductor-style. */
  name?: string;
  /** Create a git worktree for this workspace (repos only). Defaults to true. */
  worktree?: boolean;
  branch?: string;
  /** Base for the primary repo's worktree. Extra repos branch from their own default branch. */
  baseRef?: string;
  /** Which of the project's extra repos this workspace covers. Defaults to all of them. */
  repoIds?: string[];
  /**
   * Run the setup script in the background (default), wait for it (setup failure throws, the workspace is kept),
   * or skip it. Only applies to worktrees.
   */
  setup?: "background" | "await" | "skip";
};

export async function createWorkspace(input: CreateWorkspaceInput): Promise<Workspace> {
  const project = await getProject(input.projectId);
  if (!project) throw new Error("Project not found");
  const name = input.name?.trim() || (await pickWorkspaceName(project.id));

  let slug = slugify(name);
  if (await findWorkspace(project.id, { slug })) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;

  const repos = input.repoIds
    ? input.repoIds.map((id) => {
        const repo = project.extraRepos.find((r) => r.id === id);
        if (!repo) throw new Error(`Repo ${id} is not in this project`);
        return repo;
      })
    : project.extraRepos;

  const wantWorktrees = input.worktree ?? true;
  const useWorktree = wantWorktrees && project.kind === "repo";
  const branchName = input.branch?.trim() || `thunk/${slug}`;
  let cwd = project.root;
  let branch: string | null = null;
  let wtPath: string | null = null;
  let baseRef: string | null = null;
  // Every worktree made so far, so a failure part-way leaves nothing behind.
  const created: { root: string; path: string }[] = [];
  const rollback = async () => {
    for (const w of created.reverse()) await removeWorktree(w.root, w.path).catch(() => {});
  };

  const checkouts: Omit<WorkspaceRepo, "name">[] = [];
  try {
    if (useWorktree) {
      branch = branchName;
      baseRef = input.baseRef?.trim() || (await pickBaseRef(project.root, project.defaultBranch));
      wtPath = worktreePath(project.root, slug);
      await createWorktree({ root: project.root, path: wtPath, branch, baseRef });
      created.push({ root: project.root, path: wtPath });
      cwd = wtPath;
    }
    // Extra repos get worktrees on the same branch name, so the change reads as one across repos.
    for (const repo of repos) {
      if (!wantWorktrees) {
        checkouts.push(inPlace(repo));
        continue;
      }
      const repoBase = await pickBaseRef(repo.path, repo.defaultBranch);
      const repoWt = worktreePath(repo.path, slug);
      await createWorktree({ root: repo.path, path: repoWt, branch: branchName, baseRef: repoBase });
      created.push({ root: repo.path, path: repoWt });
      checkouts.push({ repoId: repo.id, cwd: repoWt, branch: branchName, worktreePath: repoWt, baseRef: repoBase });
    }
  } catch (err) {
    await rollback();
    throw err;
  }

  let ws: Workspace;
  try {
    ws = await insertWorkspace({ projectId: project.id, name, slug, cwd, branch, worktreePath: wtPath, baseRef });
  } catch (err) {
    await rollback();
    throw err;
  }
  try {
    await insertWorkspaceRepos(ws.id, checkouts);
  } catch (err) {
    await deleteWorkspaceRow(ws.id).catch(() => {});
    await rollback();
    throw err;
  }
  ws = (await getWorkspace(ws.id)) ?? ws;
  await ensureMemory(workspaceMemoryFile(project.root, ws.slug), `# ${project.name}/${ws.name} — workspace memory`);
  const setup = input.setup ?? "background";
  if (useWorktree && setup === "await") await prepareWorkspace({ project, workspace: ws });
  else if (useWorktree && setup === "background")
    void prepareWorkspace({ project, workspace: ws }).catch((err) => console.error("[thunk] workspace setup", err));
  return ws;
}

const CITY_NAMES = [
  "atlanta", "austin", "berlin", "bogota", "boston", "cairo", "chicago", "denver", "dublin", "geneva",
  "havana", "helsinki", "istanbul", "jakarta", "kyoto", "lagos", "lima", "lisbon", "london", "madrid",
  "manila", "melbourne", "miami", "milan", "montreal", "mumbai", "nairobi", "naples", "oslo", "paris",
  "porto", "prague", "quito", "reykjavik", "riga", "rome", "santiago", "seattle", "seoul", "seville",
  "sydney", "taipei", "tallinn", "tokyo", "toronto", "valencia", "vienna", "vilnius", "warsaw", "zurich",
];

/** A city name no workspace in the project uses yet; falls back to city-N once they run out. */
async function pickWorkspaceName(projectId: string) {
  const used = new Set((await listWorkspaces(projectId)).map((w) => w.slug));
  const free = CITY_NAMES.filter((c) => !used.has(c));
  if (free.length) return free[Math.floor(Math.random() * free.length)];
  const city = CITY_NAMES[Math.floor(Math.random() * CITY_NAMES.length)];
  let n = 2;
  while (used.has(`${city}-${n}`)) n++;
  return `${city}-${n}`;
}

export async function removeWorkspace(id: string, opts: { removeWorktree?: boolean; removeMemory?: boolean } = {}) {
  const ws = await getWorkspace(id);
  if (!ws) return;
  if (ws.slug === "main") throw new Error("The main workspace can't be removed");
  const project = await getProject(ws.projectId);
  if (project) {
    await withWorkspaceLock(id, async () => {
      const ctx = { project, workspace: ws };
      if (opts.removeWorktree) await assertWorkspaceCanRemove(ctx);
      if (ws.status !== "archived") await archiveWorkspaceProcesses(ctx);
      if (opts.removeWorktree) {
        await assertWorkspaceCanRemove(ctx);
        if (ws.worktreePath) await removeWorktree(project.root, ws.worktreePath);
        for (const checkout of ws.extraRepos) {
          const repo = project.extraRepos.find((r) => r.id === checkout.repoId);
          if (repo && checkout.worktreePath) await removeWorktree(repo.path, checkout.worktreePath);
        }
      }
      await deleteWorkspaceRow(id);
    });
  } else {
    await stopWorkspaceProcesses(id);
    await deleteWorkspaceRow(id);
  }
  forgetWorkspaceRuntime(id);
  if (opts.removeMemory && project)
    await rm(path.dirname(workspaceMemoryDir(project.root, ws.slug)), { force: true, recursive: true }).catch(() => {});
}

export async function getWorkspaceContext(workspaceId: string): Promise<WorkspaceContext | null> {
  const workspace = await getWorkspace(workspaceId);
  if (!workspace) return null;
  const project = await getProject(workspace.projectId);
  if (!project) return null;
  return { project, workspace };
}

/**
 * Convenience for the quick-start path: a bare directory becomes (project, workspace).
 * A linked worktree maps to its own workspace when Thunk created it, else to "main".
 */
export async function contextForDirectory(input: string): Promise<WorkspaceContext> {
  const dir = await resolveDirectory(input);
  const project = (await getProjectByRoot(dir)) ?? (await addProject(dir));
  const byCwd = dir !== project.root ? await findWorkspace(project.id, { cwd: dir }) : null;
  const workspace = byCwd ?? (await ensureMainWorkspace(project));
  return { project, workspace };
}

export type ExternalSession = {
  sdkSessionId: string;
  title: string;
  cwd: string | null;
  gitBranch: string | null;
  lastModified: string;
  createdAt: string | null;
};

/**
 * Claude Code sessions on disk for this project and its worktrees (terminal, Conductor, desktop...),
 * minus the transcripts Thunk already owns (pass their SDK session ids in `exclude`).
 */
export async function listExternalSessions(
  project: Project,
  opts: { exclude?: Iterable<string | null | undefined>; limit?: number } = {},
): Promise<ExternalSession[]> {
  const exclude = new Set([...(opts.exclude ?? [])].filter(Boolean));
  const rows = await sdkListSessions({ dir: project.root, includeWorktrees: true, limit: opts.limit ?? 30 }).catch(
    () => [],
  );
  return rows.filter((s) => !exclude.has(s.sessionId)).map((s) => ({
    sdkSessionId: s.sessionId,
    title: s.customTitle || s.summary || s.firstPrompt || "Untitled",
    cwd: s.cwd ?? null,
    gitBranch: s.gitBranch ?? null,
    lastModified: new Date(s.lastModified).toISOString(),
    createdAt: s.createdAt ? new Date(s.createdAt).toISOString() : null,
  }));
}
