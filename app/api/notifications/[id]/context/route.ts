import { handle, HttpError } from "@/lib/api/http";
import { getNotification } from "@/lib/db/repo/notifications";
import { contextFor } from "@/lib/notifications/context.server";
import { z } from "zod";

export const dynamic = "force-dynamic";

/** Quick context for one notification: where it came from, what the agent was doing, and what it needs. */
export const GET = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) throw new HttpError(400, "Invalid notification ID");
  const notification = await getNotification(id);
  if (!notification) throw new HttpError(404, "Notification not found");
  return Response.json({ context: await contextFor(notification) });
});
