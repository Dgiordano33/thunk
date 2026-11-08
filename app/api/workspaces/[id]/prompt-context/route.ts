import { handle, HttpError } from "@/lib/api/http";
import { notesDirsFor } from "@/lib/notes/resolve";
import { listNotes } from "@/lib/notes/store";
import { getWorkspaceContext } from "@/lib/projects";
import { promptContext } from "@/lib/prompts/context";

export const GET = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const context = await getWorkspaceContext(id);
  if (!context) throw new HttpError(404, "Workspace not found");
  const dirs = notesDirsFor(context.project, context.workspace);
  const [base, projectNotes, workspaceNotes] = await Promise.all([
    promptContext(context.workspace.cwd, context.project.root),
    listNotes(dirs.project).catch(() => []),
    listNotes(dirs.workspace).catch(() => []),
  ]);
  // Notes are offered under @ alongside files; the mention inserts the note's absolute path.
  const notes = [...workspaceNotes, ...projectNotes].map((n) => ({ title: n.title, path: n.path }));
  return Response.json({ ...base, notes });
});
