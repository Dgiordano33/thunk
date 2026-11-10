import { z } from "zod";
import { handle, HttpError, parseBody } from "@/lib/api/http";
import { getProject } from "@/lib/supabase/repo/projects";
import { deleteRepoFolder, setRepoFolderFiles } from "@/lib/supabase/repo/repo-folders";
import { refreshFolders } from "@/lib/notes/watch";
import { FilesBody } from "@/lib/notes/folders";
type Ctx = { params: Promise<{ id: string; folderId: string }> };
/** Change which of the folder's files the notebook shows. */
export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  const { id, folderId } = await ctx.params;
  const project = await getProject(id);
  if (!project?.repoFolders.some((f) => f.id === folderId)) throw new HttpError(404, "Notebook not found");
  const body = await parseBody(req, z.object({ files: FilesBody }));
  const folder = await setRepoFolderFiles(id, folderId, body.files);
  return Response.json({ folder });
});
export const DELETE = handle(async (_req: Request, ctx: Ctx) => {
  const { id, folderId } = await ctx.params;
  const project = await getProject(id);
  if (!project?.repoFolders.some((f) => f.id === folderId)) throw new HttpError(404, "Notebook not found");
  await deleteRepoFolder(id, folderId);
  await refreshFolders();
  return Response.json({ ok: true });
});
