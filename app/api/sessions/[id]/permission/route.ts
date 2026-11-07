import type { PermissionUpdate } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { emit, resolvePending } from "@/lib/agent";
import { handle, HttpError, parseBody, requireLive } from "@/lib/api/http";

const Body = z.object({
  requestId: z.string(),
  decision: z.enum(["allow", "allow_always", "deny"]),
  message: z.string().optional(),
  updatedInput: z.record(z.string(), z.unknown()).optional(),
});

export const POST = handle(async (req: Request, ctx: RouteContext<"/api/sessions/[id]/permission">) => {
  const { id } = await ctx.params;
  const live = requireLive(id);
  const body = await parseBody(req, Body);
  const pending = live.pending.get(body.requestId);
  if (!pending || pending.kind !== "permission") throw new HttpError(404, "No such pending permission request");

  if (body.decision === "deny") {
    resolvePending(live, body.requestId, {
      behavior: "deny",
      message: body.message?.trim()
        ? `The user denied this tool call and said: ${body.message.trim()}`
        : "The user denied this tool call.",
    });
  } else {
    resolvePending(live, body.requestId, {
      behavior: "allow",
      updatedInput: body.updatedInput ?? pending.input,
      // "Allow for this session": scope every suggestion to the session so nothing is written
      // to the user's or workspace's settings files.
      updatedPermissions:
        body.decision === "allow_always"
          ? (pending.suggestions as PermissionUpdate[] | undefined)?.map((s) => ({ ...s, destination: "session" }))
          : undefined,
    });
  }
  emit(live, {
    type: "permission_resolved",
    requestId: body.requestId,
    decision: body.decision === "deny" ? "deny" : "allow",
  });
  return Response.json({ ok: true });
});
