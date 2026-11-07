import "server-only";
import { listSessions as sdkListSessions } from "@anthropic-ai/claude-agent-sdk";
import { rm } from "node:fs/promises";
import path from "node:path";
import { getProject, getProjectByRoot, upsertProject } from "@/lib/supabase/repo/projects";
import {
  deleteWorkspace as deleteWorkspaceRow,
  findWorkspace,
  getWorkspace,
  insertWorkspace,
} from "@/lib/supabase/repo/workspaces";
import { createWorktree, detectProject, pickBaseRef, removeWorktree, resolveDirectory } from "./git";
import { ensureMemory } from "./memory";
import { projectMemoryFile, slugify, workspaceMemoryDir, workspaceMemoryFile, worktreePath } from "./paths";
import type { Project, Workspace } from "./types";

export type WorkspaceContext = { project: Project; workspace: Workspace };

/** Register (or refresh) the project that contains `input`. Idempotent per root. */
export async function addProject(input: string): Promise<Project> {
  const detected = await detectProject(input);
  const project = await upsertProject(detected);
  await ensureMemory(projectMemoryFile(project.root), `# ${project.name} — project memory`);
  return project;
}

/** The in-place workspace every project has: works directly in the root, no worktree. */
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
  await ensureMemory(workspaceMemoryFile(project.root, ws.slug), `# ${project.name}/${ws.name} — workspace memory`);
  return ws;
}

export type CreateWorkspaceInput = {
  projectId: string;
  name: string;
  /** Create a git worktree for this workspace (repos only). */
  worktree?: boolean;
  branch?: string;
  baseRef?: string;
};

export async function createWorkspace(input: CreateWorkspaceInput): Promise<Workspace> {
  const project = await getProject(input.projectId);
  if (!project) throw new Error("Project not found");
  const name = input.name.trim();
  if (!name) throw new Error("Workspace name is required");

  let slug = slugify(name);
  if (await findWorkspace(project.id, { slug })) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;

  const useWorktree = Boolean(input.worktree) && project.kind === "repo";
  let cwd = project.root;
  let branch: string | null = null;
  let wtPath: string | null = null;
  let baseRef: string | null = null;

  if (useWorktree) {
    branch = input.branch?.trim() || `thunk/${slug}`;
    baseRef = input.baseRef?.trim() || (await pickBaseRef(project.root, project.defaultBranch));
    wtPath = worktreePath(project.root, slug);
    await createWorktree({ root: project.root, path: wtPath, branch, baseRef });
    cwd = wtPath;
  }

  const ws = await insertWorkspace({ projectId: project.id, name, slug, cwd, branch, worktreePath: wtPath, baseRef }).catch(
    async (err) => {
      if (wtPath) await removeWorktree(project.root, wtPath).catch(() => {});
      throw err;
    },
  );
  await ensureMemory(workspaceMemoryFile(project.root, ws.slug), `# ${project.name}/${ws.name} — workspace memory`);
  return ws;
}

export async function removeWorkspace(id: string, opts: { removeWorktree?: boolean; removeMemory?: boolean } = {}) {
  const ws = await getWorkspace(id);
  if (!ws) return;
  if (ws.slug === "main") throw new Error("The main workspace can't be removed");
  const project = await getProject(ws.projectId);
  if (ws.worktreePath && project && opts.removeWorktree) await removeWorktree(project.root, ws.worktreePath);
  await deleteWorkspaceRow(id);
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
