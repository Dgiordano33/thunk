import { z } from "zod";
import { handle, HttpError, parseBody } from "@/lib/api/http";
import { getProject } from "@/lib/supabase/repo/projects";
import { insertRepoFolder } from "@/lib/supabase/repo/repo-folders";
import { reconcileDeclaredFolders, resolveRepoFolder } from "@/lib/notes/folders";
import { refreshFolders } from "@/lib/notes/watch";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };
export const GET = handle(async (_req: Request, ctx: Ctx) => {
  const project = await getProject((await ctx.params).id);
  if (!project) throw new HttpError(404, "Project not found");
  return Response.json({ folders: project.repoFolders });
});
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const project = await getProject((await ctx.params).id);
  if (!project) throw new HttpError(404, "Project not found");
  const body = await parseBody(req, z.object({ repoId: z.uuid(), path: z.string().min(1).max(1024), label: z.string().trim().min(1).max(200).optional() }));
  const input = { projectId: project.id, repoId: body.repoId, path: body.path, label: body.label ?? body.path };
  await resolveRepoFolder(project, input);
  const folder = await insertRepoFolder(input);
  await reconcileDeclaredFolders({ ...project, repoFolders: [...project.repoFolders, folder] });
  await refreshFolders();
  return Response.json({ folder });
});
