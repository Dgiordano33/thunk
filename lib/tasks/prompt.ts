import "server-only";
import { OPEN_TASK_STATUSES, type Task } from "./types";

export function tasksPrompt(open: Task[]) {
  const lines = [
    "# Thunk tasks",
    "Use tasks_list to refresh tasks, tasks_create to record work, tasks_update to change or claim a task (claim: true), and tasks_complete when done. IDs accept a full UUID or an unambiguous prefix. Tools are scoped to this project; claims are limited to project tasks and this workspace.",
    "When the user asks you to do something that will take more than this turn, or you discover follow-up work, create a task; claim tasks you start; complete them when done.",
    "Current open workspace and project tasks (captured at session start; use tasks_list for current state):",
  ];
  for (const [label, tasks] of [
    ["Workspace tasks", open.filter((t) => t.workspaceId !== null)],
    ["Project tasks", open.filter((t) => t.workspaceId === null)],
  ] as const) {
    const current = tasks.filter((t) => OPEN_TASK_STATUSES.some((s) => s === t.status));
    lines.push("", `## ${label}`, ...current.map((t) =>
      `- ${t.id.slice(0, 8)} · ${t.status} · ${t.title.replace(/\s+/g, " ")} · owner: ${t.sessionId ?? "unclaimed"}`));
    if (!current.length) lines.push("- (none)");
  }
  return lines.join("\n");
}
