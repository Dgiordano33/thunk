import { z } from "zod";
import { emit, resolvePending, setState } from "@/lib/agent";
import { handle, HttpError, parseBody, requireLive } from "@/lib/api/http";
import { RevisionBodySchema } from "@/lib/api/schemas";
import { requestPlanChanges } from "@/lib/revisions/plan-changes";
import { updateDocument } from "@/lib/db/repo/documents";

const Body = z.discriminatedUnion("decision", [
  z.object({
    requestId: z.string(),
    documentId: z.string(),
    decision: z.literal("approve"),
    editedMarkdown: z.string(),
    /** Mode to continue in once the plan is approved. */
    nextMode: z.enum(["acceptEdits", "default", "bypassPermissions"]).default("acceptEdits"),
  }),
  RevisionBodySchema.omit({ sessionId: true }).extend({
    requestId: z.string(),
    documentId: z.string(),
    decision: z.literal("changes"),
  }),
]);

export const POST = handle(async (req: Request, ctx: RouteContext<"/api/sessions/[id]/plan">) => {
  const { id } = await ctx.params;
  const live = requireLive(id);
  const body = await parseBody(req, Body);
  const pending = live.pending.get(body.requestId);
  if (!pending || pending.kind !== "plan") throw new HttpError(404, "No such pending plan");

  if (body.decision === "approve") {
    // Switch modes before releasing the tool call so the next edits don't prompt.
    await live.driver.setPermissionMode(body.nextMode);
    live.meta.permissionMode = body.nextMode;
    resolvePending(live, body.requestId, {
      behavior: "allow",
      updatedInput: { ...pending.input, plan: body.editedMarkdown },
    });
    emit(live, { type: "plan_resolved", requestId: body.requestId, decision: "approve" });
    setState(live, "running");
    await updateDocument(body.documentId, { status: "approved", currentMarkdown: body.editedMarkdown }).catch(
      console.error,
    );
    return Response.json({ ok: true });
  }

  const { payload, stat } = await requestPlanChanges(live, body);
  return Response.json({ ok: true, payload, stat });
});
