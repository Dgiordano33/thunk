import { z } from "zod";
import { handle, HttpError } from "@/lib/api/http";
import { countOpen, listNotifications } from "@/lib/supabase/repo/notifications";
export const dynamic = "force-dynamic";
const Query = z.object({ status: z.enum(["open", "all"]).optional(), projectId: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(500).optional(), before: z.iso.datetime().optional(), beforeId: z.string().uuid().optional() });
export const GET = handle(async (req: Request) => {
  const result = Query.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!result.success) throw new HttpError(400, "Invalid notification filters");
  const [notifications, counts] = await Promise.all([listNotifications(result.data), countOpen()]);
  return Response.json({ notifications, counts });
});
