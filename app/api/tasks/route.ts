import { z } from "zod";
import { handle, HttpError, parseBody } from "@/lib/api/http";
import { listTasks } from "@/lib/supabase/repo/tasks";
import { TaskInputSchema } from "@/lib/tasks/schema";
import { createTask } from "@/lib/tasks/service";
import { TASK_STATUSES } from "@/lib/tasks/types";
export const dynamic = "force-dynamic";
const Query = z.object({ projectId: z.uuid().optional(), workspaceId: z.uuid().optional(), sessionId: z.uuid().optional(), status: z.enum([...TASK_STATUSES, "all"]).optional() });
export const GET = handle(async (req: Request) => {
  const parsed = Query.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) throw new HttpError(400, "Invalid task filters");
  const { status, ...filters } = parsed.data;
  return Response.json({ tasks: await listTasks({ ...filters, status: !status || status === "all" ? undefined : status === "open" ? "open" : [status] }) });
});
export const POST = handle(async (req: Request) => Response.json({ task: await createTask(await parseBody(req, TaskInputSchema)) }, { status: 201 }));
