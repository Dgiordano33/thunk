import { handle, HttpError } from "@/lib/api/http";
import { getProject } from "@/lib/supabase/repo/projects";
import { suggestRepoFolders } from "@/lib/notes/folders";
export const POST = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const project = await getProject((await ctx.params).id);
  if (!project) throw new HttpError(404, "Project not found");
  return Response.json({ candidates: await suggestRepoFolders(project) });
});
