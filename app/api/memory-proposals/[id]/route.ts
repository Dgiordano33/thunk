import { handle } from "@/lib/api/http";
import { reviewMemoryProposal } from "@/lib/memory/service";

export const dynamic = "force-dynamic";

export const GET = handle(async (_req: Request, ctx: RouteContext<"/api/memory-proposals/[id]">) => {
  const { id } = await ctx.params;
  return Response.json(await reviewMemoryProposal(id));
});
