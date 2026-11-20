import { z } from "zod";
import { handle, parseBody, HttpError } from "@/lib/api/http";
import { getWorkspace } from "@/lib/db/repo/workspaces";
import { getRepoFolder } from "@/lib/db/repo/repo-folders";
import { openChief } from "@/lib/workers/service";
import { noteBrief } from "@/lib/workers/notes";
import { pushUserMessage } from "@/lib/agent";
import { hrefForSession } from "@/lib/routes.server";
import { isHomeProject } from "@/lib/home/constants";
const Body = z.object({ scope: z.object({ kind: z.enum(["projects", "workspaces", "repos"]), id: z.uuid() }).strict(), noteId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/i) }).strict();
export const POST = handle(async (req: Request) => {
  const { scope, noteId } = await parseBody(req, Body);
  const projectId = scope.kind === "projects" ? scope.id : scope.kind === "workspaces" ? (await getWorkspace(scope.id))?.projectId : (await getRepoFolder(scope.id))?.projectId;
  if (!projectId) throw new HttpError(404, "Note scope not found");
  const { getProject } = await import("@/lib/db/repo/projects");
  const project = await getProject(projectId);
  if (!project) throw new HttpError(404, "Project not found");
  if (isHomeProject(project)) {
    if (scope.kind !== "projects") throw new HttpError(404, "Note not found in this scope");
    // Top-level notes go to the top chief, which proposes where each item goes; nothing opens.
    const { openTopChief, routeRequest } = await import("@/lib/home/service");
    const request = await routeRequest(noteId, "delegate");
    if (!request.open) throw new HttpError(409, "Every checklist item is done or already routed");
    const top = await openTopChief();
    pushUserMessage(top, `${request.message}
Route these items. Propose a route_plan for the person to approve.`);
    return Response.json({ top: true, open: request.open, sessionId: top.id, workspaceId: top.meta.workspaceId, href: await hrefForSession(top.meta.workspaceId, top.id) });
  }
  const id = scope.kind === "repos" ? `r:${scope.id}:${noteId}` : noteId;
  const { note, brief } = await noteBrief(project, id);
  if (note.scope.kind !== scope.kind || note.scope.id !== scope.id) throw new HttpError(404, "Note not found in this scope");
  const chief = await openChief(projectId);
  pushUserMessage(chief, `Delegate this note: ${note.path}\nSplit unchecked checklist items into separate tasks. Use noteId ${id} for every delegate call.\n\n${brief}`);
  return Response.json({ sessionId: chief.id, workspaceId: chief.meta.workspaceId, href: await hrefForSession(chief.meta.workspaceId, chief.id) });
});
