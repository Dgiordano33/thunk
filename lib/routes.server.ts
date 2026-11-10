import "server-only";
import { getProject } from "@/lib/supabase/repo/projects";
import { getWorkspace } from "@/lib/supabase/repo/workspaces";
import { projectPath, sessionPath, workspacePath } from "./routes";

// Page URLs for code that only holds ids. A failed lookup falls back to the legacy id URL, which redirects.

async function slugs(workspaceId: string) {
  const workspace = await getWorkspace(workspaceId).catch(() => null);
  const project = workspace && (await getProject(workspace.projectId).catch(() => null));
  return project ? { project, workspace: workspace! } : null;
}

export async function hrefForProject(projectId: string) {
  const project = await getProject(projectId).catch(() => null);
  return project ? projectPath(project) : `/p/${projectId}`;
}

export async function hrefForWorkspace(workspaceId: string) {
  const ctx = await slugs(workspaceId);
  return ctx ? workspacePath(ctx.project, ctx.workspace) : `/w/${workspaceId}`;
}

export async function hrefForSession(workspaceId: string, sessionId: string) {
  const ctx = await slugs(workspaceId);
  return ctx ? sessionPath(ctx.project, ctx.workspace, sessionId) : `/w/${workspaceId}/s/${sessionId}`;
}
