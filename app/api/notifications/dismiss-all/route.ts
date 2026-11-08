import { z } from "zod";
import { handle, parseBody } from "@/lib/api/http";
import { dismissAll } from "@/lib/notifications/service";
export const POST = handle(async (req: Request) => {
  const { projectId } = await parseBody(req, z.object({ projectId: z.string().uuid().optional() }));
  return Response.json({ notifications: await dismissAll(projectId) });
});
