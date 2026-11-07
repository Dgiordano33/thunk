import { z } from "zod";
import { closeSession, setState } from "@/lib/agent";
import { handle, parseBody, requireLive } from "@/lib/api/http";
import { PERMISSION_MODES } from "@/lib/agent/types";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("interrupt") }),
  z.object({ action: z.literal("close") }),
  z.object({ action: z.literal("setModel"), value: z.string().min(1) }),
  z.object({ action: z.literal("setPermissionMode"), value: z.enum(PERMISSION_MODES) }),
]);

export const POST = handle(async (req: Request, ctx: RouteContext<"/api/sessions/[id]/control">) => {
  const { id } = await ctx.params;
  const live = requireLive(id);
  const body = await parseBody(req, Body);
  switch (body.action) {
    case "interrupt":
      await live.query.interrupt();
      break;
    case "close":
      closeSession(id);
      break;
    case "setModel":
      await live.query.setModel(body.value);
      live.meta.model = body.value;
      setState(live, live.meta.status);
      break;
    case "setPermissionMode":
      await live.query.setPermissionMode(body.value);
      live.meta.permissionMode = body.value;
      setState(live, live.meta.status);
      break;
  }
  return Response.json({ ok: true });
});
