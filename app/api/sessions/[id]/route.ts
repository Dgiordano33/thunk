import { liveMeta } from "@/lib/agent";
import { handle } from "@/lib/api/http";
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
