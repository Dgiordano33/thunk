import { handle, HttpError } from "@/lib/api/http";
import { getWorkspaceContext } from "@/lib/projects";
import { promptContext } from "@/lib/prompts/context";

export const GET = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const context = await getWorkspaceContext(id);
  if (!context) throw new HttpError(404, "Workspace not found");
  return Response.json(await promptContext(context.workspace.cwd, context.project.root));
});
