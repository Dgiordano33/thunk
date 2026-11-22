import { z } from "zod";
import { handle, parseBody } from "@/lib/api/http";
import { restore } from "@/lib/notifications/service";
export const POST = handle(async (req: Request) => {
  const { ids } = await parseBody(req, z.object({ ids: z.array(z.string().uuid()).min(1).max(500) }));
  return Response.json({ notifications: await restore(ids) });
});
