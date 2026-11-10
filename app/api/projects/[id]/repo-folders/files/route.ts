import { z } from "zod";
import { handle, HttpError, parseBody } from "@/lib/api/http";
import { getProject } from "@/lib/supabase/repo/projects";
import { resolveRepoFolder } from "@/lib/notes/folders";
import { listNotes } from "@/lib/notes/store";
export const dynamic = "force-dynamic";
/** The Markdown files a folder holds, so the picker can offer them before (or after) it becomes a notebook. */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const project = await getProject((await ctx.params).id);
  if (!project) throw new HttpError(404, "Project not found");
  const body = await parseBody(req, z.object({ repoId: z.uuid(), path: z.string().min(1).max(1024) }));
  const dirs = await resolveRepoFolder(project, body);
  const notes = await listNotes({ scope: { kind: "repos", id: "preview" }, ...dirs }, { withMemory: false });
  const files = notes.map((n) => ({ id: n.id, title: n.title, updatedAt: n.updatedAt })).sort((a, b) => a.id.localeCompare(b.id));
  return Response.json({ files });
});
