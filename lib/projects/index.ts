import "server-only";
import { listSessions as sdkListSessions } from "@anthropic-ai/claude-agent-sdk";
import { mkdir, rename, stat } from "node:fs/promises";
import { moveToGranary } from "./granary";
import path from "node:path";
import { HttpError } from "@/lib/api/errors";
import { getProject, getProjectByKey, insertProject, upsertProjectByKey } from "@/lib/supabase/repo/projects";
import {
  deleteProjectRepo,
  deleteWorkspaceRepo,
  findProjectIdByRepoPath,
  insertProjectRepo,
  insertWorkspaceRepos,
  listCheckoutsOfRepo,
  updateProjectRepo,
} from "@/lib/supabase/repo/project-repos";
import {
  deleteWorkspace as deleteWorkspaceRow,
  findWorkspace,
  findWorkspaceByCwd,
  getWorkspace,
  insertWorkspace,
  listWorkspaces,
  updateWorkspace,
} from "@/lib/supabase/repo/workspaces";
import { cloneDestination, cloneRepo, createFolder, createWorktree, detectProject, folderDestination, pickBaseRef, removeWorktree, resolveDirectory } from "./git";
import { reconcileDeclaredFolders } from "@/lib/notes/folders";
import { ensureMemory } from "./memory";
import { projectDir, projectHomeDir, projectMemoryFile, projectSlug, slugify, workspaceMemoryDir, workspaceMemoryFile, worktreePath } from "./paths";
import { repoNameFromUrl, type CreateProjectBody, type RepoResult, type RepoSpec } from "./repo-spec";
import { prepareWorkspace, archiveWorkspaceProcesses, withWorkspaceLock, forgetWorkspaceRuntime, stopWorkspaceProcesses } from "./runtime";
import { assertWorkspaceCanRemove } from "./workspace-git";
import type { Project, ProjectRepo, Workspace, WorkspaceRepo } from "./types";

export type WorkspaceContext = { project: Project; workspace: Workspace };

/** Register (or refresh) the project opened from the directory `input`. Idempotent per detected root. */
export async function addProject(input: string): Promise<Project> {
  const detected = await detectProject(input);
  const created = await upsertProjectByKey({ name: detected.name, dataKey: projectSlug(detected.root) });
  const known = created.repos.find((r) => r.path === detected.root);
  const facts = { kind: detected.kind, remote: detected.remote, defaultBranch: detected.defaultBranch };
  if (known) await updateProjectRepo(known.id, facts);
  else await insertProjectRepo({ projectId: created.id, name: detected.name, path: detected.root, ...facts });
  const project = await reconcileDeclaredFolders((await getProject(created.id))!);
  await ensureMemory(projectMemoryFile(project.dataKey), `# ${project.name} — project memory`);
  return project;
}

/** A data key no project or leftover directory uses: memory-only mode forgets projects but not their files. */
async function freshDataKey(name: string) {
  const base = slugify(name);
  for (let n = 1; ; n++) {
    const key = n === 1 ? base : `${base}-${n}`;
    if (!(await getProjectByKey(key)) && !(await stat(projectDir(key)).catch(() => null))) return key;
  }
}

/** Reject specs that could never succeed before anything is created. Side-effect free. */
async function preflightRepoSpecs(specs: RepoSpec[]) {
  const paths = new Set<string>();
  const names = new Set<string>();
  for (const spec of specs) {
    let dest: string;
    try {
      if (spec.source === "existing") dest = (await detectProject(spec.path)).root;
      else dest = spec.source === "github" ? cloneDestination(spec.url, spec.parent) : folderDestination(spec.parent, spec.folder);
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
    if (spec.source !== "existing" && (await stat(dest).catch(() => null))) throw new HttpError(400, `Already exists: ${dest}`);
    if (paths.has(dest)) throw new HttpError(400, `${dest} is listed twice`);
    paths.add(dest);
    const name = spec.name?.trim() || (spec.source === "github" ? repoNameFromUrl(spec.url) : path.basename(dest));
    if (names.has(name)) throw new HttpError(400, `Two repos would be named ${name}. Give one a different name.`);
    names.add(name);
  }
}

/** Bring one spec into being on disk and add it to the project. */
export async function addRepoFromSpec(projectId: string, spec: RepoSpec): Promise<ProjectRepo> {
  const checkout =
    spec.source === "github" ? await cloneRepo(spec.url, spec.parent)
    : spec.source === "new" ? await createFolder(spec.parent, spec.folder, { git: spec.git })
    : spec.path;
  return addProjectRepo(projectId, checkout, { name: spec.name });
}

/**
 * Create a project with its main workspace and repos. Once preflight passes, a repo that fails is reported
 * and the rest carry on: nothing is rolled back, and the failed ones can be retried with addRepoFromSpec.
 */
export async function createProject(input: CreateProjectBody) {
  await preflightRepoSpecs(input.repos);
  const created = await insertProject({ name: input.name, dataKey: await freshDataKey(input.name) });
  await ensureMemory(projectMemoryFile(created.dataKey), `# ${created.name} — project memory`);
  const main = await ensureMainWorkspace(created);
  const repos: RepoResult<ProjectRepo>[] = [];
  for (const [index, spec] of input.repos.entries()) {
    try {
      repos.push({ index, status: "added", repo: await addRepoFromSpec(created.id, spec) });
    } catch (err) {
      repos.push({ index, status: "failed", error: (err as Error).message });
    }
  }
  return { project: (await getProject(created.id))!, workspace: (await getWorkspace(main.id))!, repos };
}

/** The in-place workspace every project has: works directly in each repo, no worktrees. */
export async function ensureMainWorkspace(project: Project): Promise<Workspace> {
  const existing = await findWorkspace(project.id, { slug: "main" });
  if (existing) return existing;
  const cwd = project.repos[0]?.path ?? (await ensureHome(project));
  let ws: Workspace;
  try {
    ws = await insertWorkspace({ projectId: project.id, name: "main", slug: "main", cwd, branch: null });
  } catch (err) {
    // Two requests can both find no main workspace; the loser uses the winner's.
    const raced = (err as { code?: string }).code === "23505" ? await findWorkspace(project.id, { slug: "main" }) : null;
    if (raced) return raced;
    throw err;
  }
  await insertWorkspaceRepos(ws.id, project.repos.map(inPlace));
  await ensureMemory(workspaceMemoryFile(project.dataKey, ws.slug), `# ${project.name}/${ws.name} — workspace memory`);
  return (await getWorkspace(ws.id)) ?? ws;
}

async function ensureHome(project: Project) {
  const home = projectHomeDir(project.dataKey);
  await mkdir(home, { recursive: true });
  return home;
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
 * Add a repo or plain folder to a project, from a path inside it (any worktree resolves to the main checkout).
 * The main workspace starts working on it in place, and moves out of the home directory if it was there;
 * existing branch workspaces are left as they are.
 */
export async function addProjectRepo(projectId: string, input: string, opts: { name?: string } = {}): Promise<ProjectRepo> {
  const project = await getProject(projectId);
  if (!project) throw new Error("Project not found");
  const detected = await detectProject(input);
  const repo = await insertProjectRepo({
    projectId,
    name: opts.name?.trim() || detected.name,
    path: detected.root,
    kind: detected.kind,
    remote: detected.remote,
    defaultBranch: detected.defaultBranch,
  });
  const main = await findWorkspace(projectId, { slug: "main" });
  if (main) {
    await insertWorkspaceRepos(main.id, [inPlace(repo)]);
    if (main.cwd === projectHomeDir(project.dataKey)) await updateWorkspace(main.id, { cwd: repo.path });
  }
  // The new checkout may declare its own notebooks in thunk.json.
  await reconcileDeclaredFolders({ ...project, repos: [...project.repos, repo] });
  return repo;
}

/**
 * Drop a repo from the project. Refuses while any workspace still has a worktree of it (remove those
 * workspaces first); in-place checkouts are simply forgotten, and a workspace running in one moves to its
 * next repo, or to the home directory. Nothing on disk is touched.
 */
export async function removeProjectRepo(projectId: string, repoId: string) {
  const project = await getProject(projectId);
  const repo = project?.repos.find((r) => r.id === repoId);
  if (!project || !repo) throw new Error("Repo not found in this project");
  const checkouts = await listCheckoutsOfRepo(repoId);
  const worktrees = checkouts.filter((c) => c.worktreePath);
  if (worktrees.length) {
    const names = await Promise.all(worktrees.map(async (c) => (await getWorkspace(c.workspaceId))?.name ?? c.workspaceId));
    throw new Error(`${repo.name} still has worktrees in: ${names.join(", ")}. Remove those workspaces first.`);
  }
  for (const c of checkouts) {
    const ws = await getWorkspace(c.workspaceId);
    if (ws?.cwd === repo.path) {
      const next = ws.repos.find((r) => r.repoId !== repoId);
      await updateWorkspace(ws.id, { cwd: next?.cwd ?? (await ensureHome(project)) });
    }
    await deleteWorkspaceRepo(c.workspaceId, repoId);
  }
  await deleteProjectRepo(repoId);
}

export type CreateWorkspaceInput = {
  projectId: string;
  /** Defaults to an unused city name, Conductor-style. */
  name?: string;
  /** Create a git worktree in each chosen git repo. Defaults to true, and then needs at least one. */
  worktree?: boolean;
  branch?: string;
  /** Base for the first git repo's worktree. The others branch from their own default branch. */
  baseRef?: string;
  /** Which of the project's repos this workspace covers. Defaults to all of them. */
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
        const repo = project.repos.find((r) => r.id === id);
        if (!repo) throw new Error(`Repo ${id} is not in this project`);
        return repo;
      })
    : project.repos;

  const wantWorktrees = input.worktree ?? true;
  if (wantWorktrees && !repos.some((r) => r.kind === "repo")) throw new Error("A workspace with its own worktree needs at least one git repo");
  const branch = wantWorktrees ? input.branch?.trim() || `thunk/${slug}` : null;
  // Every worktree made so far, so a failure part-way leaves nothing behind.
  const created: { root: string; path: string }[] = [];
  const rollback = async () => {
    for (const w of created.reverse()) await removeWorktree(w.root, w.path).catch(() => {});
  };

  const checkouts: Omit<WorkspaceRepo, "name">[] = [];
  try {
    // Every repo gets a worktree on the same branch name, so the change reads as one across repos.
    for (const repo of repos) {
      if (!branch || repo.kind !== "repo") {
        checkouts.push(inPlace(repo));
        continue;
      }
      const repoBase = (!created.length && input.baseRef?.trim()) || (await pickBaseRef(repo.path, repo.defaultBranch));
      const repoWt = worktreePath(repo.path, slug);
      await createWorktree({ root: repo.path, path: repoWt, branch, baseRef: repoBase });
      created.push({ root: repo.path, path: repoWt });
      checkouts.push({ repoId: repo.id, cwd: repoWt, branch, worktreePath: repoWt, baseRef: repoBase });
    }
  } catch (err) {
    await rollback();
    throw err;
  }

  // Sessions start in the first worktree when there is one, so a leading plain folder doesn't hide the branch.
  const cwd = (checkouts.find((c) => c.worktreePath) ?? checkouts[0])?.cwd ?? (await ensureHome(project));
  let ws: Workspace;
  try {
    ws = await insertWorkspace({ projectId: project.id, name, slug, cwd, branch });
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
  await ensureMemory(workspaceMemoryFile(project.dataKey, ws.slug), `# ${project.name}/${ws.name} — workspace memory`);
  const setup = input.setup ?? "background";
  if (branch && setup === "await") await prepareWorkspace({ project, workspace: ws });
  else if (branch && setup === "background")
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

export async function removeWorkspace(id: string, opts: { removeWorktree?: boolean } = {}) {
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
        for (const checkout of ws.repos) {
          const repo = project.repos.find((r) => r.id === checkout.repoId);
          if (repo && checkout.worktreePath) await removeWorktree(repo.path, checkout.worktreePath);
        }
      }
      const saved = await moveToGranary(project.dataKey, ws.slug);
      try { await deleteWorkspaceRow(id); }
      catch (err) {
        if (saved) await rename(saved, path.dirname(workspaceMemoryDir(project.dataKey, ws.slug)));
        throw err;
      }
    });
  } else {
    await stopWorkspaceProcesses(id);
    await deleteWorkspaceRow(id);
  }
  forgetWorkspaceRuntime(id);
}

export async function getWorkspaceContext(workspaceId: string): Promise<WorkspaceContext | null> {
  const workspace = await getWorkspace(workspaceId);
  if (!workspace) return null;
  const project = await getProject(workspace.projectId);
  if (!project) return null;
  return { project, workspace };
}

/**
 * Convenience for the quick-start path: a bare directory becomes (project, workspace). A directory some
 * workspace runs in maps to it (a linked worktree Thunk created, a main checkout), else to the main
 * workspace of the project holding its repo, else to a new project.
 */
export async function contextForDirectory(input: string): Promise<WorkspaceContext> {
  const dir = await resolveDirectory(input);
  const running = await findWorkspaceByCwd(dir);
  const context = running && (await getWorkspaceContext(running.id));
  if (context) return context;
  const { root } = await detectProject(dir);
  const projectId = await findProjectIdByRepoPath(root);
  const project = (projectId && (await getProject(projectId))) || (await addProject(dir));
  return { project, workspace: await ensureMainWorkspace(project) };
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
  const limit = opts.limit ?? 30;
  const dirs = project.repos.length ? project.repos.map((r) => r.path) : [projectHomeDir(project.dataKey)];
  const perDir = await Promise.all(dirs.map((dir) => sdkListSessions({ dir, includeWorktrees: true, limit }).catch(() => [])));
  const rows = [...new Map(perDir.flat().map((s) => [s.sessionId, s])).values()].sort((a, b) => b.lastModified - a.lastModified).slice(0, limit);
  return rows.filter((s) => !exclude.has(s.sessionId)).map((s) => ({
    sdkSessionId: s.sessionId,
    title: s.customTitle || s.summary || s.firstPrompt || "Untitled",
    cwd: s.cwd ?? null,
    gitBranch: s.gitBranch ?? null,
    lastModified: new Date(s.lastModified).toISOString(),
    createdAt: s.createdAt ? new Date(s.createdAt).toISOString() : null,
  }));
}
