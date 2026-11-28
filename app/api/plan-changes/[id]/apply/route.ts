import { z } from "zod";
import { handle, parseBody } from "@/lib/api/http";
import { decidePlanChange } from "@/lib/sources/service";
import { CriteriaSchema } from "@/lib/tasks/schema";

export const dynamic = "force-dynamic";
const Body = z.object({
  choices: z.array(z.object({
    taskId: z.uuid(), decision: z.enum(["approved", "rejected"]),
    /** The person's edit of the proposed brief. */
    brief: z.string().trim().min(1).max(20_000).optional(),
    /** The person's edit of the proposed criteria; null or an empty list clears them. */
    criteria: CriteriaSchema.nullable().optional(),
  }).strict()).max(50),
});

export const POST = handle(async (req: Request, ctx: RouteContext<"/api/plan-changes/[id]/apply">) => {
  const { id } = await ctx.params;
  return Response.json({ change: await decidePlanChange(id, (await parseBody(req, Body)).choices) });
});
