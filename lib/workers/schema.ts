import { z } from "zod";
import { TaskInputSchema } from "@/lib/tasks/schema";

const Model = z.string().min(1).max(200);
export const WORKER_MODES = ["worktree", "scout"] as const;
export type WorkerMode = (typeof WORKER_MODES)[number];

/** The plain object, for MCP tool shapes. DelegateSchema adds the cross-field rules. */
export const DelegateObject = z.object({
  taskId: z.uuid().optional(), title: TaskInputSchema.shape.title.optional(),
  brief: z.string().max(20_000).optional(), noteId: TaskInputSchema.shape.noteId,
  workspaceId: z.uuid().optional().describe("Existing project workspace UUID. Omit for a fresh worktree; cannot combine with repoIds, scout or race."),
  repoIds: z.array(z.uuid()).min(1).optional().describe("Optional existing project repository UUIDs. Omit to use all Git repositories; never invent IDs."), model: Model.optional(),
  // bypassPermissions stays a person's choice: delegate is auto-approved for the chief.
  permissionMode: z.enum(["default", "acceptEdits", "plan"]).optional(),
  mode: z.enum(WORKER_MODES).optional().describe("worktree (default): edits code in its own worktree. scout: read-only in the main checkout and returns a report; works without a Git repository."),
  dependsOn: z.array(z.uuid()).max(10).optional().describe("Task IDs that must be done (accepted) before this one starts. The task is queued until then."),
  race: z.array(Model).min(2).max(3).optional().describe("Run the same task on 2–3 models, each in its own worktree. Pick the winner with workers_pick."),
}).strict();
export const DelegateSchema = DelegateObject.superRefine((d, ctx) => {
  if (d.workspaceId && d.repoIds) ctx.addIssue({ code: "custom", path: ["workspaceId"], message: "Choose workspaceId or repoIds, not both" });
  if (d.workspaceId && (d.mode === "scout" || d.race)) ctx.addIssue({ code: "custom", path: ["workspaceId"], message: "Existing workspaces cannot be used for scouts or races" });
  if (d.race && d.mode === "scout") ctx.addIssue({ code: "custom", path: ["race"], message: "Scouts cannot race; races need worktrees" });
  if (d.race && d.model) ctx.addIssue({ code: "custom", path: ["race"], message: "Use race or model, not both" });
  if (d.race && new Set(d.race).size !== d.race.length) ctx.addIssue({ code: "custom", path: ["race"], message: "Race models must differ" });
});
export type DelegateInput = z.infer<typeof DelegateObject>;

export const PlanTaskObject = z.object({
  key: z.string().trim().min(1).max(40).describe("Your short label for this task; dependsOn in this plan refers to it."),
  title: TaskInputSchema.shape.title, brief: z.string().max(20_000),
  model: Model.optional(), mode: z.enum(WORKER_MODES).optional(),
  dependsOn: z.array(z.string().trim().min(1).max(40)).max(10).optional().describe("Keys of earlier tasks in this plan."),
  race: z.array(Model).min(2).max(3).optional(),
}).strict();
export const DelegationPlanObject = z.object({
  summary: z.string().trim().min(1).max(4000),
  tasks: z.array(PlanTaskObject).min(1).max(12),
  noteId: TaskInputSchema.shape.noteId,
}).strict();
export const DelegationPlanSchema = DelegationPlanObject.superRefine((plan, ctx) => {
  const keys = new Set<string>();
  for (const [i, task] of plan.tasks.entries()) {
    if (keys.has(task.key)) ctx.addIssue({ code: "custom", path: ["tasks", i, "key"], message: `Duplicate key ${task.key}` });
    for (const dep of task.dependsOn ?? []) if (!keys.has(dep)) ctx.addIssue({ code: "custom", path: ["tasks", i, "dependsOn"], message: `${task.key} depends on ${dep}, which is not an earlier task in this plan` });
    keys.add(task.key);
  }
});
export type DelegationPlanInput = z.infer<typeof DelegationPlanObject>;
