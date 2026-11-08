// Shared by the server, agent tools, and UI.
export const TASK_STATUSES = ["open", "in_progress", "blocked", "done", "cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const OPEN_TASK_STATUSES: readonly TaskStatus[] = ["open", "in_progress", "blocked"];
export type TaskPriority = 0 | 1 | 2 | 3;
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = { open: "Open", in_progress: "In progress", blocked: "Blocked", done: "Done", cancelled: "Cancelled" };
export type Task = {
  id: string; projectId: string; workspaceId: string | null;
  title: string; body: string | null; status: TaskStatus; priority: TaskPriority; position: number;
  createdBy: "user" | "agent" | "routine";
  sessionId: string | null; createdInSessionId: string | null; noteId: string | null;
  dueAt: string | null; completedAt: string | null; createdAt: string; updatedAt: string;
};
export type TaskTree = { project: { id: string; name: string }; tasks: Task[]; workspaces: { workspace: { id: string; name: string; slug: string }; tasks: Task[] }[] };
export type TaskCounts = Record<string, { project: number; byWorkspace: Record<string, number> }>;
export type TaskEvent = { projectId: string; workspaceId: string | null; taskId: string; kind: "changed" | "removed" };
export type NoteImportScope = { workspaceId: string } | { projectId: string };
