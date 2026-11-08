import { deleteSession, liveMeta } from "@/lib/agent";
import { handle, HttpError } from "@/lib/api/http";
import { getSessionRow } from "@/lib/supabase/repo/sessions";

export const dynamic = "force-dynamic";

export const GET = handle(async (_req: Request, ctx: RouteContext<"/api/sessions/[id]">) => {
  const { id } = await ctx.params;
  const live = liveMeta(id);
  if (live) return Response.json({ session: live });
  const row = await getSessionRow(id);
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ session: { ...row, live: false } });
});

/** Delete the session, its history and its SDK transcript. */
export const DELETE = handle(async (_req: Request, ctx: RouteContext<"/api/sessions/[id]">) => {
  const { id } = await ctx.params;
  if (!(await deleteSession(id))) throw new HttpError(404, "Not found");
  return Response.json({ ok: true });
});
