import { handle } from "@/lib/api/http";
import { reviewPlanChange } from "@/lib/sources/service";

export const dynamic = "force-dynamic";

export const GET = handle(async (_req: Request, ctx: RouteContext<"/api/plan-changes/[id]">) => {
  const { id } = await ctx.params;
  return Response.json(await reviewPlanChange(id));
});
