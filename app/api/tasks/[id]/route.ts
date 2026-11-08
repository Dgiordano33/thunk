import { handle, HttpError, parseBody } from "@/lib/api/http";
import { deleteTask, getTask } from "@/lib/supabase/repo/tasks";
import { TaskPatchSchema } from "@/lib/tasks/schema";
import { patchTask, taskId } from "@/lib/tasks/service";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export const GET = handle(async (_req: Request, ctx: Context) => {
  const task = await getTask(taskId((await ctx.params).id));
  if (!task) throw new HttpError(404, "Task not found");
  return Response.json({ task });
});
export const PATCH = handle(async (req: Request, ctx: Context) => Response.json({ task: await patchTask((await ctx.params).id, await parseBody(req, TaskPatchSchema)) }));
export const DELETE = handle(async (_req: Request, ctx: Context) => {
  await deleteTask(taskId((await ctx.params).id));
  return Response.json({ ok: true });
});
