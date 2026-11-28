// Shared by the server, agent tools, and UI.
export const TASK_STATUSES = ["open", "in_progress", "blocked", "done", "cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const OPEN_TASK_STATUSES: readonly TaskStatus[] = ["open", "in_progress", "blocked"];
export type TaskPriority = 0 | 1 | 2 | 3;
/** What kind of check would show a criterion is met. */
export const CRITERION_KINDS = ["test", "interaction", "visual", "source", "other"] as const;
export type CriterionKind = (typeof CRITERION_KINDS)[number];
/** One acceptance criterion: what "done" means for part of a task. Ids are stable within the task. */
export type Criterion = { id: string; text: string; kind: CriterionKind };
/** Give criteria without ids the next free c1, c2, … so evidence can refer to them. */
export function normalizeCriteria(list: { id?: string; text: string; kind?: CriterionKind }[]): Criterion[] {
  const used = new Set(list.flatMap((c) => c.id ? [c.id] : []));
  let n = 0;
  const next = () => { do n++; while (used.has(`c${n}`)); used.add(`c${n}`); return `c${n}`; };
  const seen = new Set<string>();
  return list.filter((c) => c.text.trim()).map((c) => {
    const id = c.id && !seen.has(c.id) ? c.id : next();
    seen.add(id);
    return { id, text: c.text.trim(), kind: c.kind ?? "other" };
  });
}
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = { open: "Open", in_progress: "In progress", blocked: "Blocked", done: "Done", cancelled: "Cancelled" };
export type Task = {
  id: string; projectId: string; workspaceId: string | null;
  title: string; body: string | null; status: TaskStatus; priority: TaskPriority; position: number;
  createdBy: "user" | "agent" | "routine" | "integration";
  /** The Linear issue this task mirrors. Linear owns it; see lib/integrations/linear. */
  external: TaskExternal | null;
  sessionId: string | null; createdInSessionId: string | null; noteId: string | null;
  /** Optional acceptance criteria; null when the task has none. */
  criteria?: Criterion[] | null;
  /** Goes up each time the criteria change; evidence records the version it was gathered against. */
  criteriaVersion?: number;
  dueAt: string | null; completedAt: string | null; createdAt: string; updatedAt: string;
};
export type TaskExternal = { source: "linear"; id: string; key: string; url: string; updatedAt: string | null };
export type TaskTree = { project: { id: string; name: string }; tasks: Task[]; workspaces: { workspace: { id: string; name: string; slug: string }; tasks: Task[] }[] };
export type TaskCounts = Record<string, { project: number; byWorkspace: Record<string, number> }>;
/** `transition` marks the change that routines can fire on: a new task, or one that just became done. */
export type TaskEvent = { projectId: string; workspaceId: string | null; taskId: string; kind: "changed" | "removed"; transition?: "created" | "completed" };
export type NoteImportScope = { workspaceId: string } | { projectId: string };
