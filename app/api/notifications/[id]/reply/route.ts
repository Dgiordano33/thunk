import { handle, HttpError, parseBody } from "@/lib/api/http";
import { getNotification } from "@/lib/db/repo/notifications";
import { replyToNotification } from "@/lib/notifications/reply";
import { z } from "zod";

const Body = z.object({ content: z.string().trim().min(1, "Write a reply first").max(200_000) });

/** Reply to the agent behind a notification; see lib/notifications/reply.ts for what a reply does. */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) throw new HttpError(400, "Invalid notification ID");
  const { content } = await parseBody(req, Body);
  const n = await getNotification(id);
  if (!n) throw new HttpError(404, "Notification not found");
  return Response.json({ ok: true, mode: await replyToNotification(n, content) });
});
