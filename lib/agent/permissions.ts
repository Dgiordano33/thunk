import "server-only";
import type { CanUseTool, PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import { emit, setState, type LiveSession, type PendingRequest } from "./session-registry";
import type { Question } from "./types";

/**
 * Every tool call the SDK can't auto-approve lands here. We park it as a
 * pending request, surface it to the UI as an event, and resolve when the
 * user answers via a POST route (or the SDK aborts it).
 */
export function buildCanUseTool(live: LiveSession): CanUseTool {
  return (toolName, input, opts) => {
    const requestId = crypto.randomUUID();
    const toolUseId = opts.toolUseID;
    let kind: PendingRequest["kind"] = "permission";

    if (toolName === "AskUserQuestion") {
      kind = "question";
      emit(live, {
        type: "ask_question",
        requestId,
        toolUseId,
        questions: (input.questions as Question[]) ?? [],
      });
    } else if (toolName === "ExitPlanMode") {
      kind = "plan";
      const prev = live.lastPlan?.changesRequested ? live.lastPlan : null;
      const documentId = crypto.randomUUID();
      const version = prev ? prev.version + 1 : 1;
      live.lastPlan = { documentId, version, changesRequested: false };
      emit(live, {
        type: "plan_proposed",
        requestId,
        toolUseId,
        documentId,
        plan: typeof input.plan === "string" ? input.plan : "",
        parentDocumentId: prev?.documentId,
        version,
      });
    } else {
      emit(live, {
        type: "permission_request",
        requestId,
        toolUseId,
        toolName,
        input,
        title: opts.title,
        description: opts.description,
        decisionReason: opts.decisionReason,
        suggestions: opts.suggestions as Record<string, unknown>[] | undefined,
      });
    }

    setState(live, "awaiting");

    return new Promise<PermissionResult>((resolve) => {
      const onAbort = () => {
        if (!live.pending.delete(requestId)) return;
        if (kind === "permission") emit(live, { type: "permission_resolved", requestId, decision: "cancelled" });
        if (kind === "question") emit(live, { type: "question_resolved", requestId, answers: null });
        if (kind === "plan") emit(live, { type: "plan_resolved", requestId, decision: "cancelled" });
        resolve({ behavior: "deny", message: "The request was cancelled." });
      };
      opts.signal.addEventListener("abort", onAbort, { once: true });
      live.pending.set(requestId, {
        kind,
        toolName,
        toolUseId,
        input,
        suggestions: opts.suggestions,
        resolve: (result) => {
          opts.signal.removeEventListener("abort", onAbort);
          resolve(result);
        },
      });
    });
  };
}
