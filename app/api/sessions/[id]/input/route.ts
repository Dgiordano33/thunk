import { z } from "zod";
import { pushUserMessage } from "@/lib/agent";
import { handle, parseBody, requireLive } from "@/lib/api/http";

const Body = z.object({ content: z.string().trim().min(1, "content is required") });

export const POST = handle(async (req: Request, ctx: RouteContext<"/api/sessions/[id]/input">) => {
  const { id } = await ctx.params;
  const live = requireLive(id);
  const { content } = await parseBody(req, Body);
  const messageId = pushUserMessage(live, content);
  return Response.json({ messageId });
});
