import { z } from "zod";
import { handle, parseBody } from "@/lib/api/http";
import { DocCommentSchema } from "@/lib/api/schemas";
import { syncComments } from "@/lib/supabase/repo/documents";

const Body = z.object({ comments: z.array(DocCommentSchema) });

/** Replace the document's comment threads with the client's current set. */
export const PUT = handle(async (req: Request, ctx: RouteContext<"/api/documents/[id]/comments">) => {
  const { id } = await ctx.params;
  const { comments } = await parseBody(req, Body);
  await syncComments(id, comments);
  return Response.json({ ok: true });
});
