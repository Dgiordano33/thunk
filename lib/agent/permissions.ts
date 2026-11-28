import { BOARD_TOOL_NAMES, CANVAS_TOOL_NAMES, hasCanvasTools } from "@/lib/board/tools";
import { CHIEF_TOOL_NAMES, TOP_CHIEF_DISALLOWED_TOOLS, asksChiefFirst, readOnlyDenial, readOnlySession, readOnlyViolation } from "@/lib/workers/prompt";
import { TOP_CHIEF_TOOL_NAMES } from "@/lib/home/prompt";
import "server-only";
import type { CanUseTool, PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import { emit, setState, type LiveSession, type PendingRequest } from "./session-registry";
import { TASK_TOOL_NAMES } from "@/lib/tasks/tools";
import { VAULT_TOOL_NAMES } from "@/lib/vault/tools";
import { MEMORY_TOOL_NAMES } from "@/lib/memory/tools";
import type { Question } from "./types";

/**
 * Every tool call the SDK can't auto-approve lands here. We park it as a
 * pending request, surface it to the UI as an event, and resolve when the
 * user answers via a POST route (or the SDK aborts it).
 */
export function buildCanUseTool(live: LiveSession): CanUseTool {
  return (toolName, input, opts) => {
    if (live.meta.origin?.kind === "top_chief" && TOP_CHIEF_DISALLOWED_TOOLS.includes(toolName))
      return Promise.resolve({ behavior: "deny", message: "The top chief routes work. Use route_plan; project chiefs do the work." });
    if (live.meta.origin?.kind === "top_chief" && TOP_CHIEF_TOOL_NAMES.some((name) => toolName === `mcp__thunk__${name}`))
      return Promise.resolve({ behavior: "allow", updatedInput: input });
    const violation = readOnlySession(live.meta.origin) ? readOnlyViolation(toolName, input) : null;
    if (violation) return Promise.resolve({ behavior: "deny", message: readOnlyDenial(live.meta.origin, violation) });
    if (live.meta.origin?.kind === "chief" && CHIEF_TOOL_NAMES.some((name) => toolName === `mcp__thunk__${name}`))
      return Promise.resolve({ behavior: "allow", updatedInput: input });
    if ([...(live.meta.origin?.kind === "board" ? BOARD_TOOL_NAMES : hasCanvasTools(live) ? CANVAS_TOOL_NAMES : []), ...TASK_TOOL_NAMES, ...VAULT_TOOL_NAMES, ...MEMORY_TOOL_NAMES, "notify"].some((name) => toolName === `mcp__thunk__${name}`))
      return Promise.resolve({ behavior: "allow", updatedInput: input });

    const requestId = crypto.randomUUID();
    const toolUseId = opts.toolUseID;
    let kind: PendingRequest["kind"] = "permission";
    const questions = (input.questions as Question[]) ?? [];
    const routedTo = toolName === "AskUserQuestion" && asksChiefFirst(live) ? "chief" as const : undefined;

    if (toolName === "AskUserQuestion") {
      kind = "question";
      emit(live, { type: "ask_question", requestId, toolUseId, questions, ...(routedTo ? { routedTo } : {}) });
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

    const result = new Promise<PermissionResult>((resolve) => {
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
        routedTo,
        resolve: (result) => {
          opts.signal.removeEventListener("abort", onAbort);
          resolve(result);
        },
      });
    });
    // After the request is parked, so status listeners can see who owns it.
    setState(live, "awaiting");
    if (routedTo) void import("@/lib/workers/questions").then((m) => m.forwardQuestion(live, requestId, questions))
      .catch((err) => console.error("[thunk] forwarding a question to the chief failed", err));
    return result;
  };
}
