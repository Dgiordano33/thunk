import { handle, HttpError } from "@/lib/api/http";
import { getNotification } from "@/lib/db/repo/notifications";
import { briefFor } from "@/lib/notifications/brief";
import { contextFor } from "@/lib/notifications/context.server";
import { z } from "zod";

export const dynamic = "force-dynamic";

/** A model-written brief of the notification as it stands. `brief` is null when there is nothing to say or no model to ask. */
export const GET = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) throw new HttpError(400, "Invalid notification ID");
  const notification = await getNotification(id);
  if (!notification) throw new HttpError(404, "Notification not found");
  const context = await contextFor(notification);
  return Response.json({ brief: await briefFor(notification, context), key: context.briefKey });
});
