import "server-only";
import { OPEN_TASK_STATUSES, type Task } from "./types";
import { contextKey, type ContextItemDraft, type PromptPart } from "@/lib/context/types";

/** The text a task's change is judged by. */
export const taskSource = (t: Pick<Task, "title" | "status" | "body">) => `${t.title}\n${t.status}\n${t.body ?? ""}`;

export function tasksPrompt(all: Task[], { exclude }: { exclude?: Set<string> } = {}): PromptPart {
  const open = all.filter((t) => !exclude?.has(contextKey("task", t.id)));
  const items: ContextItemDraft[] = [];
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
    const rows = current.map((t) =>
      `- ${t.id.slice(0, 8)} · ${t.status} · ${t.external ? `${t.external.key} ` : ""}${t.title.replace(/\s+/g, " ")} · owner: ${t.sessionId ?? "unclaimed"}`);
    current.forEach((t, i) => items.push({ kind: "task", refId: t.id, title: t.title, mode: "index", chars: rows[i].length, source: taskSource(t) }));
    lines.push("", `## ${label}`, ...rows);
    if (!current.length) lines.push("- (none)");
  }
  return { text: lines.join("\n"), items };
}
