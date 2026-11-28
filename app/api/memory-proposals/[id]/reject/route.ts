import { handle } from "@/lib/api/http";
import { rejectMemoryProposal } from "@/lib/memory/service";

export const dynamic = "force-dynamic";

export const POST = handle(async (_req: Request, ctx: RouteContext<"/api/memory-proposals/[id]/reject">) => {
  const { id } = await ctx.params;
  return Response.json({ proposal: await rejectMemoryProposal(id) });
});
