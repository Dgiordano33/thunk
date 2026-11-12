import "server-only";
import { z } from "zod";
import type { LiveSession } from "@/lib/agent";
import { DelegateSchema } from "./schema";

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
  return [
    define("delegate", "Delegate a task. Supply workspaceId to use an existing project workspace, or omit it for a new worktree. Supply title and brief to create a task, or taskId to use an existing task. repoIds selects repositories for a new worktree only; omit it to use all project Git repositories. New worktrees wait for setup, which can take a minute. At most four active workers, one per workspace; wait for pushed reports when full.", DelegateSchema.shape, async (input) => (await import("./service")).delegate(live.meta.projectId, live.id, input)),
    define("workers_status", "Snapshot of project worker tasks, live states, pending prompts, branches and latest reports. No polling needed.", {}, async () => (await import("./service")).workersStatus(live.meta.projectId, true)),
    define("workers_message", "Send follow-up instructions to a worker; queued if it is mid-turn.", { taskId: z.uuid(), content: z.string().trim().min(1).max(20_000) }, async ({ taskId, content }) => (await import("./service")).messageWorker(live.meta.projectId, taskId, content)),
    define("workers_stop", "Stop a worker and cancel its task, retaining the worktree.", { taskId: z.uuid(), reason: z.string().trim().min(1).max(2000) }, async ({ taskId, reason }) => (await import("./service")).stopWorker(live.meta.projectId, taskId, reason)),
    define("workers_answer", "Answer a <worker_question>. answers maps each question's exact text to an option label or your own words.", { questionId: z.uuid(), answers: z.record(z.string(), z.string().trim().min(1).max(4000)) }, async ({ questionId, answers }) => {
      (await import("./questions")).answerQuestion(live.meta.projectId, questionId, answers);
      return { answered: true };
    }),
    define("workers_escalate", "Send a <worker_question> to the person with your recommendation, when it needs their judgment.", { questionId: z.uuid(), recommendation: z.string().trim().min(1).max(4000) }, async ({ questionId, recommendation }) => {
      await (await import("./questions")).escalateQuestion(questionId, recommendation, "The chief asked for your decision.", live.meta.projectId);
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
