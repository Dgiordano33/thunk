import { z } from "zod";
import { emit, resolvePending } from "@/lib/agent";
import { handle, HttpError, parseBody, requireLive } from "@/lib/api/http";

const Body = z.object({
  requestId: z.string(),
  /** question text → chosen label(s), comma-joined for multiSelect; null to skip. */
  answers: z.record(z.string(), z.string()).nullable(),
});

export const POST = handle(async (req: Request, ctx: RouteContext<"/api/sessions/[id]/answer">) => {
  const { id } = await ctx.params;
  const live = requireLive(id);
  const body = await parseBody(req, Body);
  const pending = live.pending.get(body.requestId);
  if (!pending || pending.kind !== "question") throw new HttpError(404, "No such pending question");

  resolvePending(
    live,
    body.requestId,
    body.answers
      ? { behavior: "allow", updatedInput: { ...pending.input, answers: body.answers } }
      : { behavior: "deny", message: "The user dismissed the question without answering." },
  );
  emit(live, { type: "question_resolved", requestId: body.requestId, answers: body.answers });
  return Response.json({ ok: true });
});
