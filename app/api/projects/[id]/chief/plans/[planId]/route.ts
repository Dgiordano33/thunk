import { z } from "zod";
import { handle, HttpError, parseBody } from "@/lib/api/http";
import { taskId } from "@/lib/tasks/service";
import { decidePlan } from "@/lib/workers/plans";

const Body = z.object({ decision: z.enum(["approve", "reject"]), note: z.string().max(4000).nullable().optional() }).strict();

/** Approve or reject a chief's proposed delegation plan; the chief is told either way. */
export const POST = handle(async (req: Request, ctx: RouteContext<"/api/projects/[id]/chief/plans/[planId]">) => {
  const { id, planId } = await ctx.params;
  const body = await parseBody(req, Body);
  try {
    return Response.json(await decidePlan(taskId(id), taskId(planId), body.decision, body.note));
  } catch (err) {
    const message = (err as Error).message;
    if (/not found/i.test(message)) throw new HttpError(404, message);
    if (/already/i.test(message)) throw new HttpError(409, message);
    throw err;
  }
});
