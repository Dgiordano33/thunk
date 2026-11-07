import { ImagesSchema } from "@/lib/prompts/schema";
import { expandCommand } from "@/lib/prompts/context";
import { z } from "zod";
import { pushUserMessage } from "@/lib/agent";
import { handle, parseBody, requireLive } from "@/lib/api/http";

const Body = z.object({ content: z.string().trim().max(200_000), images: ImagesSchema }).refine((b) => b.content || b.images.length, "A message or image is required");

export const POST = handle(async (req: Request, ctx: RouteContext<"/api/sessions/[id]/input">) => {
  const { id } = await ctx.params;
  const live = requireLive(id);
  const { content, images } = await parseBody(req, Body);
  const messageId = pushUserMessage(live, content, { images, expandedContent: await expandCommand(content, live.ctx.project.root) });
  return Response.json({ messageId });
});
