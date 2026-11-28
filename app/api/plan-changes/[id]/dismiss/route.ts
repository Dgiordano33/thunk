import { handle } from "@/lib/api/http";
import { dismissPlanChange } from "@/lib/sources/service";

export const dynamic = "force-dynamic";

export const POST = handle(async (_req: Request, ctx: RouteContext<"/api/plan-changes/[id]/dismiss">) => {
  const { id } = await ctx.params;
  return Response.json({ change: await dismissPlanChange(id) });
});
