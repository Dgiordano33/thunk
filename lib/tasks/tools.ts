import "server-only";
import { z } from "zod";
import { listTasks } from "@/lib/supabase/repo/tasks";
import { getWorkspace } from "@/lib/supabase/repo/workspaces";
import { TaskInputSchema, TaskPatchSchema } from "./schema";
import { createTask, patchTask } from "./service";
import { OPEN_TASK_STATUSES, type Task } from "./types";

/** `routine`: the session was started by a routine. Its work defaults to project scope so it outlives the run's worktree. */
export type TaskToolContext = { projectId: string; workspaceId: string; sessionId: string; routine?: boolean };
export const TASK_TOOL_NAMES = ["tasks_list", "tasks_create", "tasks_update", "tasks_complete"] as const;

/** Resolve only against the caller's project-scoped candidates, including completed tasks. */
export function resolveTaskId(id: string, tasks: readonly Task[]): string {
  const prefix = id.trim().toLowerCase();
  if (!/^[0-9a-f]{1,8}(?:-[0-9a-f]{0,4}){0,3}(?:-[0-9a-f]{0,12})?$/.test(prefix))
    throw new Error("Use a task UUID or an unambiguous UUID prefix.");
  const matches = tasks.filter((task) => task.id.toLowerCase().startsWith(prefix));
  if (!matches.length) throw new Error("Task not found in this project.");
  if (matches.length !== 1) throw new Error("Ambiguous task ID; use a longer prefix or the full UUID.");
  return matches[0].id;
}

const compact = (tasks: Task[]) => tasks.length
  ? tasks.map((t) => `${t.id} · ${t.status} · ${t.title.replace(/\s+/g, " ")} · ${t.sessionId ?? "unclaimed"}`).join("\n")
  : "No tasks.";

function defineTool<S extends z.ZodRawShape>(name: typeof TASK_TOOL_NAMES[number], description: string, schema: S,
  run: (args: z.infer<z.ZodObject<S>>) => Promise<string>) {
  return { name, description, schema, async handler(input: unknown) {
    try {
      const text = await run(z.strictObject(schema).parse(input));
      return { content: [{ type: "text" as const, text }], isError: false };
    } catch (error) {
      return { content: [{ type: "text" as const, text: error instanceof Error ? error.message : "Task operation failed." }], isError: true };
    }
  } };
}

export function tasksTools(ctx: TaskToolContext) {
  async function projectTasks() {
    const workspace = await getWorkspace(ctx.workspaceId);
    if (!workspace || workspace.projectId !== ctx.projectId) throw new Error("Workspace does not belong to this project.");
    return listTasks({ projectId: ctx.projectId });
  }
  async function findTask(id: string) {
    const tasks = await projectTasks();
    const resolved = resolveTaskId(id, tasks);
    return tasks.find((task) => task.id === resolved)!;
  }
  const id = z.string().min(1).max(36);
  const defaultScope = ctx.routine ? "project" : "workspace";
  return [
    defineTool("tasks_list", `List tasks in this project. Workspace scope shows this workspace; project scope shows project-level tasks; all includes every workspace. Defaults to ${ctx.routine ? "all" : "workspace"} scope.`, {
      scope: z.enum(["workspace", "project", "all"]).optional(), status: z.enum(["open", "all"]).optional(),
    }, async ({ scope = ctx.routine ? "all" : "workspace", status = "open" }) => {
      const tasks = await projectTasks();
      return compact(tasks.filter((t) => (scope === "all" || t.workspaceId === (scope === "workspace" ? ctx.workspaceId : null))
        && (status === "all" || OPEN_TASK_STATUSES.some((s) => s === t.status))));
    }),
    defineTool("tasks_create", `Create a task in this workspace or at project level, owned by the current session. Defaults to ${defaultScope} scope.`, {
      title: TaskInputSchema.shape.title, body: TaskInputSchema.shape.body.optional(),
      scope: z.enum(["workspace", "project"]).optional(), priority: TaskInputSchema.shape.priority.optional(),
    }, async ({ scope = defaultScope, ...args }) => {
      await projectTasks();
      const task = await createTask(TaskInputSchema.parse({ ...args, projectId: ctx.projectId,
        workspaceId: scope === "workspace" ? ctx.workspaceId : null, sessionId: ctx.sessionId }),
      { createdBy: ctx.routine ? "routine" : "agent", createdInSessionId: ctx.sessionId });
      return compact([task]);
    }),
    defineTool("tasks_update", "Update a task by UUID or unique prefix. Claim only project-level tasks or tasks in this workspace.", {
      id, status: TaskPatchSchema.shape.status, title: TaskPatchSchema.shape.title, body: TaskPatchSchema.shape.body,
      priority: TaskPatchSchema.shape.priority, claim: z.boolean().optional(),
    }, async ({ id, claim, ...patch }) => {
      const task = await findTask(id);
      if (claim && task.workspaceId !== null && task.workspaceId !== ctx.workspaceId)
        throw new Error("Cannot claim a task in another workspace.");
      const updated = await patchTask(task.id, TaskPatchSchema.parse({ ...patch, ...(claim ? { sessionId: ctx.sessionId } : {}) }));
      if (!updated) throw new Error("Task no longer exists.");
      return compact([updated]);
    }),
    defineTool("tasks_complete", "Complete a task by UUID or unique prefix, optionally appending a completion note to its body.", {
      id, note: z.string().max(20_000).optional(),
    }, async ({ id, note }) => {
      const task = await findTask(id);
      const patch = TaskPatchSchema.parse({ status: "done", ...(note ? { body: [task.body, note].filter(Boolean).join("\n\n") } : {}) });
      const updated = await patchTask(task.id, patch);
      if (!updated) throw new Error("Task no longer exists.");
      return compact([updated]);
    }),
  ];
}
