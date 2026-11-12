import "server-only";
import { getSession, pushUserMessage, resumeSession } from "@/lib/agent";
import { withFileLock } from "@/lib/notes/file-write";
import { notify, resolveBySubject } from "@/lib/notifications/service";
import { sessionPath } from "@/lib/routes";
import { getProject } from "@/lib/supabase/repo/projects";
import { appendWorkLog } from "./log";
import { currentChiefId } from "./report-up";
import { DelegationPlanSchema, type DelegationPlanInput } from "./schema";
import { readWorkerState, updateWorkerState, type DelegationPlan } from "./state";

const subject = (planId: string) => `chief:plan:${planId}`;

export function renderPlan(plan: Pick<DelegationPlan, "summary" | "tasks">) {
  return [plan.summary, "", ...plan.tasks.map((t, i) => {
    const how = [t.mode === "scout" ? "scout" : null, t.race ? `race ${t.race.join(" vs ")}` : t.model ?? null, t.dependsOn?.length ? `after ${t.dependsOn.join(", ")}` : null].filter(Boolean).join(" · ");
    return `${i + 1}. [${t.key}] ${t.title}${how ? ` (${how})` : ""}\n   ${t.brief.split("\n")[0].slice(0, 300)}`;
  })].join("\n");
}

/** Store the chief's proposed split and ask the person to approve it in the inbox. Nothing starts until they do. */
export async function proposePlan(projectId: string, chiefSessionId: string, input: DelegationPlanInput) {
  const args = DelegationPlanSchema.parse(input);
  const chief = getSession(chiefSessionId);
  if (chief?.meta.projectId !== projectId || chief.meta.origin?.kind !== "chief") throw new Error("Only this project's chief can propose a delegation plan");
  const project = await getProject(projectId);
  if (!project) throw new Error("Project not found");
  const plan: DelegationPlan = { ...args, id: crypto.randomUUID(), chiefSessionId, status: "pending", createdAt: new Date().toISOString(), decidedAt: null, note: null, taskIds: {} };
  await updateWorkerState(project, (s) => { s.plans[plan.id] = plan; });
  const path = `/api/projects/${projectId}/chief/plans/${plan.id}`;
  await notify({
    projectId, workspaceId: chief.meta.workspaceId, sessionId: chiefSessionId, kind: "delegation_plan", urgency: "action",
    subjectKey: subject(plan.id), title: `Chief plan · ${plan.tasks.length} task${plan.tasks.length === 1 ? "" : "s"}`,
    detail: renderPlan(plan), href: sessionPath(chief.ctx.project, chief.ctx.workspace, chiefSessionId),
    actions: [
      { label: "Approve", method: "POST", path, body: { decision: "approve" } },
      { label: "Reject", method: "POST", path, body: { decision: "reject" } },
    ],
  });
  await appendWorkLog(project, `[chief] proposed plan: ${plan.tasks.map((t) => t.title).join(" · ")}`);
  return { planId: plan.id, status: "pending" as const, message: "Waiting for the person to approve in the inbox. You will get a <delegation_plan> message with the decision; do not delegate these tasks yourself meanwhile." };
}

/**
 * Approve (delegate every task in order, mapping plan keys to task ids for dependencies) or reject.
 * Either way the chief hears the outcome and the inbox item resolves. Deciding twice is refused.
 */
export async function decidePlan(projectId: string, planId: string, decision: "approve" | "reject", note?: string | null) {
  const project = await getProject(projectId);
  if (!project) throw new Error("Project not found");
  return withFileLock(`plan:${planId}`, async () => {
    const plan = (await readWorkerState(project)).plans[planId];
    if (!plan) throw new Error("Delegation plan not found");
    if (plan.status !== "pending") throw new Error(`This plan was already ${plan.status}`);
    const chiefId = await currentChiefId(plan.chiefSessionId);
    const results: { key: string; title: string; taskId?: string; queued?: boolean; error?: string }[] = [];
    if (decision === "approve") {
      const { delegate } = await import("./service");
      for (const t of plan.tasks) {
        const missing = (t.dependsOn ?? []).filter((k) => !plan.taskIds[k]);
        if (missing.length) { results.push({ key: t.key, title: t.title, error: `Skipped: ${missing.join(", ")} did not start` }); continue; }
        try {
          const started = await delegate(projectId, chiefId && getSession(chiefId)?.meta.origin?.kind === "chief" ? chiefId : null, {
            title: t.title, brief: t.brief, model: t.model, mode: t.mode, race: t.race, noteId: plan.noteId,
            dependsOn: t.dependsOn?.map((k) => plan.taskIds[k]),
          });
          plan.taskIds[t.key] = started.taskId;
          results.push({ key: t.key, title: t.title, taskId: started.taskId, queued: "queued" in started });
        } catch (err) { results.push({ key: t.key, title: t.title, error: (err as Error).message }); }
      }
    }
    const decided = { ...plan, status: decision === "approve" ? "approved" as const : "rejected" as const, decidedAt: new Date().toISOString(), note: note?.trim() || null };
    await updateWorkerState(project, (s) => { s.plans[planId] = decided; });
    await resolveBySubject(subject(planId));
    await appendWorkLog(project, `[you] decision: delegation plan ${decided.status}${decided.note ? ` · ${decided.note}` : ""}`);
    const chief = chiefId ? await resumeSession(chiefId).catch(() => null) : null;
    if (chief) {
      const body = decision === "approve"
        ? results.map((r) => `- [${r.key}] ${r.title}: ${r.error ?? `${r.queued ? "queued" : "started"} as task ${r.taskId}`}`).join("\n")
        : `The person rejected this plan${decided.note ? `: ${decided.note}` : "."} Revise it with them before delegating.`;
      pushUserMessage(chief, `<delegation_plan id="${planId}" status="${decided.status}">\n${body}\n</delegation_plan>`);
    }
    return { planId, status: decided.status, results };
  });
}
