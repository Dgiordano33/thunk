import { handle, HttpError } from "@/lib/api/http";
import { getProject } from "@/lib/supabase/repo/projects";
import { deleteRepoFolder } from "@/lib/supabase/repo/repo-folders";
import { refreshFolders } from "@/lib/notes/watch";
export const DELETE = handle(async (_req: Request, ctx: { params: Promise<{ id: string; folderId: string }> }) => {
  const { id, folderId } = await ctx.params;
  const project = await getProject(id);
  if (!project?.repoFolders.some((f) => f.id === folderId)) throw new HttpError(404, "Notebook not found");
  await deleteRepoFolder(id, folderId);
  await refreshFolders();
  return Response.json({ ok: true });
});
