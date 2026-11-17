import { z } from "zod";
import { handle, HttpError, parseBody } from "@/lib/api/http";
import { taskId } from "@/lib/tasks/service";
import { decideRoutePlan } from "@/lib/home/service";

const Body = z.object({ decision: z.enum(["approve", "reject"]), note: z.string().max(4000).nullable().optional() }).strict();

/** Approve or reject the top chief's routing plan; the top chief is told either way. */
export const POST = handle(async (req: Request, ctx: RouteContext<"/api/chief/routes/[planId]">) => {
  const { planId } = await ctx.params;
  const body = await parseBody(req, Body);
  try {
    return Response.json(await decideRoutePlan(taskId(planId), body.decision, body.note));
  } catch (err) {
    const message = (err as Error).message;
    if (/not found/i.test(message)) throw new HttpError(404, message);
    if (/already/i.test(message)) throw new HttpError(409, message);
    throw err;
  }
});
