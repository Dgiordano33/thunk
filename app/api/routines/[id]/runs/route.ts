import { handle } from "@/lib/api/http";
import { listRuns } from "@/lib/supabase/repo/routines";

export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request, ctx: RouteContext<"/api/routines/[id]/runs">) => {
  const { id } = await ctx.params;
  const limit = Math.min(100, Math.max(1, Number(new URL(req.url).searchParams.get("limit")) || 20));
  return Response.json({ runs: await listRuns(id, limit) }, { headers: { "Cache-Control": "no-store" } });
});
