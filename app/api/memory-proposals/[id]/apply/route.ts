import { z } from "zod";
import { handle, parseBody } from "@/lib/api/http";
import { applyMemoryProposal } from "@/lib/memory/service";

export const dynamic = "force-dynamic";
const Body = z.object({
  choices: z.array(z.object({ id: z.string().min(1).max(64), decision: z.enum(["accepted", "rejected"]), text: z.string().max(20_000).optional() })).max(100),
  /** The hash of MEMORY.md the review screen showed; a different one means memory changed and items are re-matched. */
  memoryHash: z.string().min(1).max(64),
  /** "Edit as document": the whole resulting MEMORY.md, as the person edited it. */
  document: z.string().max(200_000).optional(),
});

export const POST = handle(async (req: Request, ctx: RouteContext<"/api/memory-proposals/[id]/apply">) => {
  const { id } = await ctx.params;
  return Response.json(await applyMemoryProposal(id, await parseBody(req, Body)));
});
