import "server-only";
import { emit, getSession, isTerminated, pushUserMessage, resolvePending, resumeSession, WorkspaceArchivedError } from "@/lib/agent";
import { HttpError } from "@/lib/api/errors";
import { sessionConfigRoot } from "@/lib/projects/repos";
import { expandCommand } from "@/lib/prompts/context";
import { requestPlanChanges } from "@/lib/revisions/plan-changes";
import { requestIdOf, type ReplyMode } from "./context";
import { resolveBySubject } from "./service";
import type { Notification } from "./types";

/**
 * Reply to the agent behind a notification, in words. A pending question is answered, a pending permission is
 * denied with the note, a pending plan gets the note as requested changes; anything else is a message to the
 * session, which is resumed first if it has stopped.
 */
export async function replyToNotification(n: Notification, content: string): Promise<ReplyMode> {
  if (!n.sessionId) throw new HttpError(409, "This notification has no session to reply to.");
  const current = getSession(n.sessionId);
  const requestId = requestIdOf(n);
  const pending = requestId && current && !isTerminated(current) ? current.pending.get(requestId) : undefined;
  if (current && requestId && pending) {
    const asked = current.events.findLast((e) => "requestId" in e && e.requestId === requestId && (e.type === "ask_question" || e.type === "plan_proposed"));
    if (pending.kind === "question" && asked?.type === "ask_question") {
      const answers = Object.fromEntries(asked.questions.map((q) => [q.question, content]));
      resolvePending(current, requestId, { behavior: "allow", updatedInput: { ...pending.input, answers } });
      emit(current, { type: "question_resolved", requestId, answers });
      return "answer";
    }
    if (pending.kind === "permission") {
      resolvePending(current, requestId, { behavior: "deny", message: `The user denied this tool call and said: ${content}` });
      emit(current, { type: "permission_resolved", requestId, decision: "deny" });
      return "deny";
    }
    if (pending.kind === "plan" && asked?.type === "plan_proposed") {
      await requestPlanChanges(current, {
        requestId, documentId: asked.documentId, version: asked.version, baselineMarkdown: asked.plan, editedMarkdown: asked.plan,
        comments: [{ id: crypto.randomUUID(), status: "open", kind: "change", quote: "", context: "The whole plan", body: content, replies: [] }],
      });
      return "changes";
    }
  }

  const live = await resumeSession(n.sessionId).catch((err) => {
    throw err instanceof WorkspaceArchivedError ? new HttpError(409, err.message) : err;
  });
  if (!live) throw new HttpError(404, "This notification's session no longer exists.");
  pushUserMessage(live, content, { expandedContent: await expandCommand(content, sessionConfigRoot(live.ctx)) });
  // The agent asked for help and got an answer: its request has been dealt with.
  if (n.kind === "agent_request" && n.status === "open") await resolveBySubject(n.subjectKey);
  return "message";
}
