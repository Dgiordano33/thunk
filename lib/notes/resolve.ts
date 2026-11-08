import "server-only";
import { HttpError } from "@/lib/api/http";
import { getWorkspaceContext } from "@/lib/projects";
import { projectMemoryFile, projectNotesDir, workspaceMemoryFile, workspaceNotesDir } from "@/lib/projects/paths";
import type { Project, Workspace, RepoFolder } from "@/lib/projects/types";
import { getProject, listProjects } from "@/lib/supabase/repo/projects";
import { resolveRepoFolder } from "./folders";
import type { NoteDirs } from "./store";
import type { NoteScope, NoteScopeKind } from "./types";

export function projectNoteDirs(project: Project): NoteDirs {
  return {
    scope: { kind: "projects", id: project.id },
    notesDir: projectNotesDir(project.root),
    memoryFile: projectMemoryFile(project.root),
    memoryTitle: "Project memory",
  };
}

export function workspaceNoteDirs(project: Project, workspace: Workspace): NoteDirs {
  return {
    scope: { kind: "workspaces", id: workspace.id },
    notesDir: workspaceNotesDir(project.root, workspace.slug),
    memoryFile: workspaceMemoryFile(project.root, workspace.slug),
    memoryTitle: "Workspace memory",
  };
}

/** Both scopes a session in this workspace sees. */
export async function notesDirsFor(project: Project, workspace: Workspace) {
  return { project: projectNoteDirs(project), workspace: workspaceNoteDirs(project, workspace), repos: await repoDirsFor(project) };
}

/** Resolve an API scope (`projects/<id>` or `workspaces/<id>`) to its dirs, 404 when it doesn't exist. */
export async function dirsForScope(scope: NoteScope | { kind: NoteScopeKind; id: string }): Promise<NoteDirs> {
  if (scope.kind === "repos") {
    for (const project of await listProjects()) {
      const folder = project.repoFolders.find((f) => f.id === scope.id);
      if (folder) return repoNoteDirs(project, folder);
    }
    throw new HttpError(404, "Repo notebook not found");
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
  return { scope: { kind: "repos", id: folder.id }, ...await resolveRepoFolder(project, folder) };
}

export async function repoDirsFor(project: Project): Promise<NoteDirs[]> {
  const dirs = await Promise.all(project.repoFolders.map((f) => repoNoteDirs(project, f).catch(() => null)));
  return dirs.filter((d): d is NoteDirs => d !== null);
}
