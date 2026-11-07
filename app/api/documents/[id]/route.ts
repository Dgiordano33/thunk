import { z } from "zod";
import { handle, parseBody } from "@/lib/api/http";
import { updateDocument } from "@/lib/supabase/repo/documents";

const Body = z.object({
  currentMarkdown: z.string().optional(),
  baselineMarkdown: z.string().optional(),
  contentJson: z.unknown().optional(),
});

export const PATCH = handle(async (req: Request, ctx: RouteContext<"/api/documents/[id]">) => {
  const { id } = await ctx.params;
  await updateDocument(id, await parseBody(req, Body));
  return Response.json({ ok: true });
});
