import "server-only";
import { z } from "zod";
import type { LiveSession } from "@/lib/agent";
import { DelegateObject, DelegationPlanObject } from "./schema";

export function chiefTools(live: LiveSession) {
  if (live.meta.origin?.kind !== "chief") return [];
  function define<S extends z.ZodRawShape>(name: string, description: string, schema: S, run: (input: z.infer<z.ZodObject<S>>) => Promise<unknown>) {
    return { name, description, schema, async handler(input: unknown) {
      try {
        const result = await run(z.strictObject(schema).parse(input));
        return { content: [{ type: "text" as const, text: JSON.stringify(result) ?? "Done" }], isError: false };
      } catch (err) {
        return { content: [{ type: "text" as const, text: (err as Error).message }], isError: true };
      }
    } };
  }
  const projectId = live.meta.projectId;
  const service = () => import("./service");
  return [
    define("delegate", "Delegate a task. Supply title and brief to create a task, or taskId to use an existing one. Omit repoIds to use the project Git repositories. mode \"scout\" is read-only research in the main checkout with no worktree. dependsOn queues the task until those tasks are done; when all four worker slots are busy the task is queued too, and it starts on its own. race runs the same task on 2–3 models. Waits for worktree setup, which can take a minute.", DelegateObject.shape, async (input) => (await service()).delegate(projectId, live.id, input)),
    define("delegate_plan", "Propose how you will split a request into tasks, for the person to approve in their inbox before anything starts. Use it before starting two or more workers for one request. You get a <delegation_plan> message with the decision; approved tasks are delegated for you, in order, with dependsOn keys mapped to task ids.", DelegationPlanObject.shape, async (input) => (await import("./plans")).proposePlan(projectId, live.id, input)),
    define("workers_status", "Snapshot of worker tasks (live states, pending prompts, branches, diffs, files that overlap with other workers, races, cost) and the queue. No polling needed.", {}, async () => (await service()).workersStatus(projectId, true)),
    define("workers_message", "Send follow-up instructions to a worker; queued if it is mid-turn. Pass sessionId to reach a specific racer.", { taskId: z.uuid(), content: z.string().trim().min(1).max(20_000), sessionId: z.uuid().optional() }, async ({ taskId, content, sessionId }) => (await service()).messageWorker(projectId, taskId, content, sessionId)),
    define("workers_stop", "Stop a worker (every racer, if the race is undecided) or remove a queued task, and cancel the task. Worktrees are kept.", { taskId: z.uuid(), reason: z.string().trim().min(1).max(2000) }, async ({ taskId, reason }) => (await service()).stopWorker(projectId, taskId, reason)),
    define("workers_pick", "Choose the winning racer for a raced task. The winner owns the task; the others stop and their workspaces are archived with branches kept.", { taskId: z.uuid(), sessionId: z.uuid() }, async ({ taskId, sessionId }) => (await service()).pickRaceWinner(projectId, taskId, sessionId)),
    define("workers_integrate", "Trial-merge the named workers' branches, in order, into a fresh integration worktree and run thunk.json scripts.test there. Reports which branches merge cleanly, which conflict and on which files, and the test result. Nothing is merged into the default branch.", { taskIds: z.array(z.uuid()).min(1).max(12), runTests: z.boolean().optional() }, async ({ taskIds, runTests }) => (await import("./integrate")).integrateWorkers(projectId, taskIds, { runTests: runTests ?? true })),
    define("workers_history", "Delegation history for this project: cost, minutes and rounds per task, and per model how often a task was accepted after one round. Use it to choose a model.", {}, async () => (await service()).workersHistory(projectId)),
    define("workers_answer", "Answer a <worker_question>. answers maps each question's exact text to an option label or your own words.", { questionId: z.uuid(), answers: z.record(z.string(), z.string().trim().min(1).max(4000)) }, async ({ questionId, answers }) => {
      (await import("./questions")).answerQuestion(projectId, questionId, answers);
      return { answered: true };
    }),
    define("workers_escalate", "Send a <worker_question> to the person with your recommendation, when it needs their judgment.", { questionId: z.uuid(), recommendation: z.string().trim().min(1).max(4000) }, async ({ questionId, recommendation }) => {
      await (await import("./questions")).escalateQuestion(questionId, recommendation, "The chief asked for your decision.", projectId);
      return { escalated: true };
    }),
    define("chief_log", "Append outcomes or decisions to today's work log. Optionally replace workspace memory with the current plan.", { entry: z.string().trim().min(1).max(20_000), plan: z.string().max(24_000).optional() }, async ({ entry, plan }) => {
      const { appendWorkLog, saveChiefPlan } = await import("./log");
      if (plan !== undefined) await saveChiefPlan(live.ctx.project, plan);
      const note = await appendWorkLog(live.ctx.project, `[chief] outcome: ${entry}`);
      return { path: note?.path };
    }),
  ];
}
