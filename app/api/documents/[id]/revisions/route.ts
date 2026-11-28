import { createTwoFilesPatch } from "diff";
import { pushUserMessage } from "@/lib/agent";
import { handle, parseBody, requireLive } from "@/lib/api/http";
import { RevisionBodySchema } from "@/lib/api/schemas";
import { buildRevisionPayload } from "@/lib/revisions/build-payload";
import { insertRevision, updateDocument } from "@/lib/db/repo/documents";
import { documentRevised } from "@/lib/sources/service";

/** Build the <document_revision> payload and push it as the next user message. */
export const POST = handle(async (req: Request, ctx: RouteContext<"/api/documents/[id]/revisions">) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, RevisionBodySchema);
  const live = requireLive(body.sessionId);

  const { payload, stat } = buildRevisionPayload({ documentId: id, kind: "response", ...body });
  live.pendingRevision = { documentId: id, version: body.version };
  pushUserMessage(live, payload, {
    kind: "revision",
    documentId: id,
    stat: { edits: stat.hunks, comments: stat.comments },
  });

  await Promise.all([
    updateDocument(id, { status: "sent", currentMarkdown: body.editedMarkdown }),
    insertRevision({
      documentId: id,
      diff: createTwoFilesPatch("original.md", "edited.md", body.baselineMarkdown, body.editedMarkdown),
      payload,
      stat,
    }),
  ]).catch((err) => console.error("[thunk] persist revision failed", err));
  // Tasks delegated from this plan hear about it through their project's chief.
  void documentRevised(id, body.baselineMarkdown, body.editedMarkdown).catch((err) => console.error("[thunk] source revision failed", err));

  return Response.json({ payload, stat });
});
