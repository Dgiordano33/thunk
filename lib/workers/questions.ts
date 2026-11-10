import "server-only";
import { emit, getSession, pushUserMessage, refreshWaitingOn, resolvePending, resumeSession, type LiveSession } from "@/lib/agent";
import type { Question } from "@/lib/agent/types";
import { appendWorkLog } from "./log";
import { currentChiefId } from "./report-up";

/** How long the chief has to answer before a question goes to the person. */
export const CHIEF_ANSWER_MINUTES = 10;

type Routed = { workerId: string; timer: ReturnType<typeof setTimeout> };
// Pinned to globalThis so HMR keeps the timers attached to their questions.
const g = globalThis as typeof globalThis & { __thunkChiefQuestions?: Map<string, Routed> };
const routed = g.__thunkChiefQuestions ??= new Map();

const render = (questions: Question[]) => questions.map((q) =>
  `- ${q.question}${q.multiSelect ? " (several allowed, comma-separated)" : ""}\n${q.options.map((o) => `  - ${o.label}${o.description ? `: ${o.description}` : ""}`).join("\n")}`,
).join("\n");

/** Post a worker's AskUserQuestion to its chief. The worker's call stays parked until someone answers. */
export async function forwardQuestion(live: LiveSession, requestId: string, questions: Question[], { timeoutMs = CHIEF_ANSWER_MINUTES * 60_000 } = {}) {
  const origin = live.meta.origin;
  if (origin?.kind !== "worker" || !origin.chiefSessionId) return;
  const timer = setTimeout(() => void escalateQuestion(requestId, null, `The chief did not answer within ${Math.round(timeoutMs / 60_000)} minutes.`)
    .catch((err) => console.error("[thunk] question escalation failed", err)), timeoutMs);
  timer.unref?.();
  routed.set(requestId, { workerId: live.id, timer });
  try {
    const chiefId = await currentChiefId(origin.chiefSessionId);
    const chief = chiefId ? await resumeSession(chiefId) : null;
    if (!chief) return await escalateQuestion(requestId, null, "This project has no chief to answer.");
    pushUserMessage(chief, `<worker_question id="${requestId}" task="${origin.taskId}" session="${live.id}">\nWorker "${live.meta.title ?? origin.taskId}" asks:\n${render(questions)}\n</worker_question>`);
    await appendWorkLog(live.ctx.project, `[worker] asked the chief: ${live.meta.title ?? origin.taskId} · ${questions.map((q) => q.question).join(" · ")}`);
  } catch (err) {
    await escalateQuestion(requestId, null, `Could not reach the chief: ${(err as Error).message}`);
  }
}

function claim(projectId: string, questionId: string) {
  const entry = routed.get(questionId);
  const live = entry && getSession(entry.workerId);
  const pending = live?.pending.get(questionId);
  if (!entry || !live || live.meta.projectId !== projectId || pending?.kind !== "question") {
    if (entry && (!live || pending?.kind !== "question")) forget(questionId);
    throw new Error("No open worker question with that id. It may have been answered, escalated to the person, or cancelled.");
  }
  return { live, pending };
}
function forget(questionId: string) {
  clearTimeout(routed.get(questionId)?.timer);
  routed.delete(questionId);
}

/** The chief's answer resolves the parked call exactly as the person's answer route does. */
export function answerQuestion(projectId: string, questionId: string, answers: Record<string, string>) {
  const { live, pending } = claim(projectId, questionId);
  const asked = ((pending.input.questions as Question[] | undefined) ?? []).map((q) => q.question);
  const missing = asked.filter((q) => !answers[q]?.trim());
  if (missing.length) throw new Error(`Answer every question, keyed by its exact text. Missing: ${missing.map((q) => JSON.stringify(q)).join(", ")}`);
  forget(questionId);
  const picked = Object.fromEntries(asked.map((q) => [q, answers[q].trim()]));
  resolvePending(live, questionId, { behavior: "allow", updatedInput: { ...pending.input, answers: picked } });
  emit(live, { type: "question_resolved", requestId: questionId, answers: picked, by: "chief" });
  void appendWorkLog(live.ctx.project, `[chief] answered ${live.meta.title ?? live.id}: ${asked.map((q) => `${q} → ${picked[q]}`).join(" · ")}`)
    .catch((err) => console.error("[thunk] work log failed", err));
}

/** Hand the question to the person, with the chief's recommendation when it has one. */
export async function escalateQuestion(questionId: string, recommendation: string | null, reason: string, projectId?: string) {
  const entry = routed.get(questionId);
  const live = entry && getSession(entry.workerId);
  if (projectId !== undefined) claim(projectId, questionId);
  forget(questionId);
  if (!live?.pending.has(questionId)) return;
  const pending = live.pending.get(questionId)!;
  pending.routedTo = undefined;
  refreshWaitingOn(live);
  emit(live, { type: "question_escalated", requestId: questionId, recommendation, reason });
  await appendWorkLog(live.ctx.project, `[worker] blocked: ${live.meta.title ?? live.id} · question escalated to you · ${reason}`);
}
