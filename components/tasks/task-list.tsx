"use client";
import { needsPerson } from "@/lib/agent/types";
import { TASK_STATUS_LABELS, type Task, type TaskStatus } from "@/lib/tasks/types";
import { TaskRow, type TaskRowProps } from "./task-row";

export function TaskList({ tasks, emptyText = "No tasks yet.", busyId, ...actions }: Omit<TaskRowProps, "task" | "busy"> & { tasks: Task[]; emptyText?: string; busyId?: string | null }) {
  if (!tasks.length) return <p className="text-muted-foreground px-3 py-4 text-xs">{emptyText}</p>;
  const waiting = (t: Task) => actions.sessions.some((s) => s.id === t.sessionId && s.origin?.kind === "worker" && needsPerson(s));
  const pending = tasks.filter(waiting);
  const group = (status: TaskStatus) => {
    const items = tasks.filter((t) => t.status === status && !waiting(t)).sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt));
    if (!items.length) return null;
    const list = <ul>{items.map((task) => <TaskRow key={task.id} task={task} busy={busyId === task.id} {...actions} />)}</ul>;
    return status === "done" || status === "cancelled"
      ? <details key={status} className="border-t"><summary className="cursor-pointer px-3 py-2 text-xs text-muted-foreground">{TASK_STATUS_LABELS[status]} ({items.length})</summary>{list}</details>
      : <section key={status}><h3 className="px-3 pt-3 pb-1 text-[11px] font-medium text-muted-foreground">{TASK_STATUS_LABELS[status]} ({items.length})</h3>{list}</section>;
  };
  return <div>{pending.length > 0 && <section><h3 className="px-3 pt-3 pb-1 text-[11px] font-medium text-muted-foreground">Waiting for you ({pending.length})</h3><ul>{pending.map((task) => <TaskRow key={task.id} task={task} busy={busyId === task.id} {...actions} />)}</ul></section>}{(["open", "in_progress", "blocked", "done", "cancelled"] as const).map(group)}</div>;
}
