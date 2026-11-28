import { handle, HttpError } from "@/lib/api/http";
import { sessionContext, sessionWorkspace } from "@/lib/context/service";

/** What the session was given: prompt items, fetched and attached ones, and what was left out, each with `changedSince`. */
export const GET = handle(async (_req: Request, ctx: RouteContext<"/api/sessions/[id]/context">) => {
  const { id } = await ctx.params;
  const workspace = await sessionWorkspace(id);
  if (!workspace) throw new HttpError(404, "Unknown session");
  return Response.json({ items: await sessionContext(id, workspace) });
});
