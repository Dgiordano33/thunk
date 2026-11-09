import { handle, HttpError } from "@/lib/api/http";
import { notesDirsFor } from "@/lib/notes/resolve";
import { listNotes } from "@/lib/notes/store";
import { getWorkspaceContext } from "@/lib/projects";
import { sessionConfigRoot } from "@/lib/projects/repos";
import { promptContext } from "@/lib/prompts/context";

export const GET = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const context = await getWorkspaceContext(id);
  if (!context) throw new HttpError(404, "Workspace not found");
  const dirs = await notesDirsFor(context.project, context.workspace);
  const [base, projectNotes, workspaceNotes, repoNotes] = await Promise.all([
    promptContext(context.workspace.cwd, sessionConfigRoot(context)),
    listNotes(dirs.project).catch(() => []),
    listNotes(dirs.workspace).catch(() => []),
    Promise.all(dirs.repos.map((d) => listNotes(d).catch(() => []))),
  ]);
  // Notes are offered under @ alongside files; the mention inserts the note's absolute path.
  const notes = [...workspaceNotes, ...projectNotes, ...repoNotes.flat()].map((n) => ({ title: n.title, path: n.path }));
  return Response.json({ ...base, notes });
});
