import { resumeSession, WorkspaceArchivedError } from "@/lib/agent";
import { handle, HttpError } from "@/lib/api/http";

export const POST = handle(async (_req: Request, ctx: RouteContext<"/api/sessions/[id]/resume">) => {
  const { id } = await ctx.params;
  const live = await resumeSession(id).catch((err) => {
    throw err instanceof WorkspaceArchivedError ? new HttpError(409, err.message) : err;
  });
  if (!live) throw new HttpError(404, "Unknown session");
  return Response.json({ session: { ...live.meta, live: true }, seq: live.seq });
});
