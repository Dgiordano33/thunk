import { handle, HttpError } from "@/lib/api/http";
import { getWorkspaceContext } from "@/lib/projects";
import { harvestProposalStatus, startHarvestProposal } from "@/lib/memory/harvest";

export const dynamic = "force-dynamic";

/** Harvest → Propose an update: start a short read-only session that ends in memory_propose. */
export const POST = handle(async (_req: Request, route: RouteContext<"/api/workspaces/[id]/harvest/propose">) => {
  const { id } = await route.params;
  const ctx = await getWorkspaceContext(id);
  if (!ctx) throw new HttpError(404, "Workspace not found");
  if (ctx.workspace.status === "archived") throw new HttpError(409, "This workspace is archived. Unarchive it to propose an update, or add the log as is.");
  return Response.json(await startHarvestProposal(ctx));
});

/** The dialog polls this until the session's proposal exists, or the session stops without one. */
export const GET = handle(async (req: Request) => {
  const sessionId = new URL(req.url).searchParams.get("sessionId");
  if (!sessionId) throw new HttpError(400, "sessionId is required");
  return Response.json(await harvestProposalStatus(sessionId));
});
