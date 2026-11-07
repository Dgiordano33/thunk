import { z } from "zod";
import { closeSession, setState } from "@/lib/agent";
import { handle, HttpError, parseBody, requireLive } from "@/lib/api/http";
import { PERMISSION_MODES, permissionModesFor, providerOf } from "@/lib/agent/types";

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
      await live.driver.interrupt();
      break;
    case "close":
      closeSession(id);
      break;
    case "setModel":
      // Claude and Codex transcripts aren't interchangeable; the client opens a new chat instead.
      if (providerOf(body.value) !== providerOf(live.meta.model))
        throw new HttpError(400, "Switching between Claude and Codex needs a new chat");
      await live.driver.setModel(body.value);
      live.meta.model = body.value;
      setState(live, live.meta.status);
      break;
    case "setPermissionMode":
      if (!permissionModesFor(providerOf(live.meta.model)).includes(body.value))
        throw new HttpError(400, `${body.value} isn't available for this model`);
      await live.driver.setPermissionMode(body.value);
      live.meta.permissionMode = body.value;
      setState(live, live.meta.status);
      break;
  }
  return Response.json({ ok: true });
});
