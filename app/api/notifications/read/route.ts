import { z } from "zod";
import { handle, parseBody } from "@/lib/api/http";
import { markRead } from "@/lib/notifications/service";
export const POST = handle(async (req: Request) => {
  const { ids } = await parseBody(req, z.object({ ids: z.array(z.string().uuid()).max(500) }));
  return Response.json({ notifications: await markRead(ids) });
});
