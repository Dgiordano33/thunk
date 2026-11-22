import { z } from "zod";
import { handle, parseBody } from "@/lib/api/http";
import { dismissAll, dismissMany } from "@/lib/notifications/service";
export const POST = handle(async (req: Request) => {
  const { projectId, ids } = await parseBody(req, z.object({ projectId: z.string().uuid().optional(), ids: z.array(z.string().uuid()).max(500).optional() }));
  return Response.json({ notifications: ids ? await dismissMany(ids) : await dismissAll(projectId) });
});
