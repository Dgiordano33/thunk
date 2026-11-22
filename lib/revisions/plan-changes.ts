import "server-only";
import { emit, resolvePending, type LiveSession } from "@/lib/agent";
import { insertRevision, updateDocument } from "@/lib/db/repo/documents";
import { buildRevisionPayload, type RevisionComment } from "./build-payload";

/** Send a pending plan back with edits and comments; the agent revises and proposes it again. */
export async function requestPlanChanges(live: LiveSession, body: {
  requestId: string; documentId: string; version: number; baselineMarkdown: string; editedMarkdown: string; comments: RevisionComment[];
}) {
  const { payload, stat } = buildRevisionPayload({
    documentId: body.documentId,
    version: body.version,
    kind: "plan",
    baselineMarkdown: body.baselineMarkdown,
    editedMarkdown: body.editedMarkdown,
    comments: body.comments,
  });
  if (live.lastPlan?.documentId === body.documentId) live.lastPlan.changesRequested = true;
  resolvePending(live, body.requestId, { behavior: "deny", message: payload });
  emit(live, { type: "plan_resolved", requestId: body.requestId, decision: "changes" });
  await Promise.all([
    updateDocument(body.documentId, { status: "sent", currentMarkdown: body.editedMarkdown }),
    insertRevision({ documentId: body.documentId, diff: "", payload, stat }),
  ]).catch(console.error);
  return { payload, stat };
}
