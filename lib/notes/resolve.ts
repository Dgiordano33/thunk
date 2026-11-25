import "server-only";
import { isHomeProject } from "@/lib/home/constants";
import { HttpError } from "@/lib/api/http";
import { getWorkspaceContext } from "@/lib/projects";
import { projectMemoryFile, projectNotesDir, workspaceNotesDir } from "@/lib/projects/paths";
import type { Project, Workspace, RepoFolder } from "@/lib/projects/types";
import { getProject } from "@/lib/db/repo/projects";
import { getRepoFolder } from "@/lib/db/repo/repo-folders";
import { resolveRepoFolder } from "./folders";
import type { NoteDirs } from "./store";
import type { NoteScope, NoteScopeKind } from "./types";
import { listWorkspaces } from "@/lib/db/repo/workspaces";
import { listTasks, updateTask } from "@/lib/db/repo/tasks";
import { migrateWorkspaceNotes } from "./migrate";
import { NoteConflictError } from "./file-write";

const migrations = new Map<string, Promise<void>>();
/** Projects whose legacy workspace notes were migrated by this process. */
const migrated = new Set<string>();

/**
 * Move legacy workspace notes into project storage. Conflicting files are preserved and logged
 * rather than thrown, so one bad file can't block the project's notes. Reads use the per-process
 * cache; archive, removal and Harvest pass `force` to pick up anything written since.
 */
export function migrateProjectNotes(project: Project, { force = false } = {}): Promise<void> {
  if (!force && migrated.has(project.id)) return Promise.resolve();
  const current = migrations.get(project.id);
  if (current) return current;
  const pending = (async () => {
    for (const workspace of await listWorkspaces(project.id)) {
      await migrateWorkspaceNotes(workspaceNotesDir(project.dataKey, workspace.slug), projectNotesDir(project.dataKey), workspace.id, async (from, to) => {
        for (const task of await listTasks({ projectId: project.id, workspaceId: workspace.id })) {
          if (task.noteId === from) await updateTask(task.id, { noteId: to });
        }
      }).catch((err) => {
        if (!(err instanceof NoteConflictError)) throw err;
        console.warn(`[notes] legacy notes for workspace ${workspace.id} need review: ${err.message}`);
      });
    }
    migrated.add(project.id);
  })().finally(() => migrations.delete(project.id));
  migrations.set(project.id, pending);
  return pending;
}

export function projectNoteDirs(project: Project): NoteDirs {
  return {
    scope: { kind: "projects", id: project.id },
    notesDir: projectNotesDir(project.dataKey),
    memoryFile: projectMemoryFile(project.dataKey),
    memoryTitle: isHomeProject(project) ? "Routing memory" : "Project memory",
    // Reads must keep working even if migration hits an unexpected error; it retries next access.
    prepare: () => migrateProjectNotes(project).catch((err) => console.warn("[notes] legacy note migration failed:", err)),
  };
}

export function workspaceNoteDirs(project: Project, workspace: Workspace): NoteDirs {
  return {
    ...projectNoteDirs(project),
    workspaceId: workspace.id,
    // Runtime memory remains separate from user notes.
    memoryFile: undefined,
    memoryTitle: undefined,
  };
}

/** Both scopes a session in this workspace sees. */
export async function notesDirsFor(project: Project, workspace: Workspace) {
  return { project: projectNoteDirs(project), workspace: workspaceNoteDirs(project, workspace), repos: await repoDirsFor(project) };
}

/** Resolve an API scope (`projects/<id>` or `workspaces/<id>`) to its dirs, 404 when it doesn't exist. */
export async function dirsForScope(scope: NoteScope | { kind: NoteScopeKind; id: string }): Promise<NoteDirs> {
  if (scope.kind === "repos") {
    const folder = await getRepoFolder(scope.id);
    const project = folder && await getProject(folder.projectId);
    // getProject drops folders whose repo left the project; treat those as gone too.
    if (!folder || !project?.repoFolders.some((f) => f.id === folder.id)) throw new HttpError(404, "Repo notebook not found");
    return repoNoteDirs(project, folder);
  }
  if (scope.kind === "projects") {
    const project = await getProject(scope.id);
    if (!project) throw new HttpError(404, "Project not found");
    return projectNoteDirs(project);
  }
  const ctx = await getWorkspaceContext(scope.id);
  if (!ctx) throw new HttpError(404, "Workspace not found");
  return workspaceNoteDirs(ctx.project, ctx.workspace);
}

export async function repoNoteDirs(project: Project, folder: RepoFolder): Promise<NoteDirs> {
  return { scope: { kind: "repos", id: folder.id }, ...await resolveRepoFolder(project, folder), ...(folder.files ? { include: folder.files } : {}) };
}

export async function repoDirsFor(project: Project): Promise<NoteDirs[]> {
  const dirs = await Promise.all(project.repoFolders.map((f) => repoNoteDirs(project, f).catch(() => null)));
  return dirs.filter((d): d is NoteDirs => d !== null);
}
