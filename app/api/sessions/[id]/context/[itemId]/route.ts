import { z } from "zod";
import { handle, parseBody } from "@/lib/api/http";
import { sendNoteUpdate, setItemRemoved } from "@/lib/context/actions";

const Body = z.object({ action: z.enum(["update", "remove", "keep"]) });

/** `update`: send a changed note as a `<note_update>` diff. `remove` / `keep`: leave a prompt item out of (or back in) the next start or resume. */
export const POST = handle(async (req: Request, ctx: RouteContext<"/api/sessions/[id]/context/[itemId]">) => {
  const { id, itemId } = await ctx.params;
  const { action } = await parseBody(req, Body);
  const items = action === "update" ? await sendNoteUpdate(id, itemId) : await setItemRemoved(id, itemId, action === "remove");
  return Response.json({ items });
});
