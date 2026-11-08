import { handle, HttpError } from "@/lib/api/http";
import { dismiss } from "@/lib/notifications/service";
import { z } from "zod";
export const POST = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) throw new HttpError(400, "Invalid notification ID");
  return Response.json({ notifications: await dismiss(id) });
});
