import { canvasPath } from "@/lib/routes";
import type { LiveSession } from "@/lib/agent/session-registry";
import type { HarnessEvent } from "@/lib/agent/types";
import { notify, resolveBySubject, resolveWhere } from "./service";
import type { Notification } from "./types";
import { hrefForSession } from "@/lib/routes.server";

export async function sessionNotification(live: LiveSession, e: HarnessEvent & { advice?: string }) {
  const sessionId = live.id;
  const base = { projectId: live.meta.projectId, workspaceId: live.meta.workspaceId, sessionId,
    href: live.meta.origin?.kind === "board" ? canvasPath(live.ctx.project) : await hrefForSession(live.meta.workspaceId, sessionId) };
  if (e.type === "ask_question" && e.routedTo) return;
  if (e.type === "question_escalated") {
    const asked = live.events.findLast((q) => q.type === "ask_question" && q.requestId === e.requestId);
    if (asked?.type !== "ask_question") return;
    const advice = [e.recommendation && `Chief recommends: ${e.recommendation}`, e.reason].filter(Boolean).join("\n");
    return sessionNotification(live, { ...asked, routedTo: undefined, advice });
  }
  if (e.type === "permission_request" || e.type === "ask_question" || e.type === "plan_proposed") {
    const kind = e.type === "permission_request" ? "permission" : e.type === "ask_question" ? "question" : "plan";
    const actions: Notification["actions"] = [];
    if (e.type === "permission_request") for (const decision of ["allow", "deny"]) actions.push({ label: decision === "allow" ? "Allow" : "Deny", method: "POST", path: `/api/sessions/${sessionId}/permission`, body: { requestId: e.requestId, decision } });
    if (e.type === "plan_proposed") actions.push({ label: "Approve plan", method: "POST", path: `/api/sessions/${sessionId}/plan`, body: { requestId: e.requestId, documentId: e.documentId, decision: "approve", editedMarkdown: e.plan } });
    if (e.type === "ask_question" && e.questions.length === 1 && !e.questions[0].multiSelect) {
      const question = e.questions[0];
      for (const option of question.options) actions.push({ label: option.label, method: "POST", path: `/api/sessions/${sessionId}/answer`, body: { requestId: e.requestId, answers: { [question.question]: option.label } } });
    }
    await notify({ ...base, kind, urgency: "action", subjectKey: `session:${sessionId}:req:${e.requestId}`,
      title: e.type === "permission_request" ? e.title || `Allow ${e.toolName}?` : e.type === "ask_question" ? e.questions.map((q) => q.question).join(" · ") : "Plan ready for review",
      detail: e.type === "permission_request" ? e.description ?? e.decisionReason ?? JSON.stringify(e.input) : e.type === "plan_proposed" ? e.plan : e.advice ?? null, actions });
  } else if (e.type === "permission_resolved" || e.type === "question_resolved" || e.type === "plan_resolved") {
    await resolveBySubject(`session:${sessionId}:req:${e.requestId}`);
  } else if (e.type === "result" && live.meta.origin?.kind !== "routine" && live.meta.origin?.kind !== "worker") {
    await notify({ ...base, kind: e.isError ? "turn_failed" : "turn_finished", urgency: "info",
      subjectKey: `session:${sessionId}:result:${e.seq}`, title: `${live.meta.title || "Agent"} · ${e.isError ? "Turn failed" : "Turn finished"}` });
  } else if (e.type === "error") {
    await notify({ ...base, kind: "session_error", urgency: "info", subjectKey: `session:${sessionId}:error:${e.seq}`, title: "Session error", detail: e.message });
  } else if (e.type === "status" && (e.state === "closed" || e.state === "error")) {
    await resolveWhere({ sessionId, kinds: ["permission", "question", "plan", "session_stuck", "agent_request"] });
  }
}
