"use client";
import Link from "next/link";
import { Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SessionMeta } from "@/lib/agent/types";
import { TASK_STATUS_LABELS, type Task } from "@/lib/tasks/types";
import { SendMenu } from "./send-menu";
import { usePaths } from "@/components/layout/paths-context";

export type TaskRowProps = {
  task: Task;
  sessions: SessionMeta[];
  busy?: boolean;
  onToggle: (task: Task) => void;
  onPatch: (task: Task) => void;
  onSend: (task: Task, sessionId: string | null) => void;
  onDelete: (task: Task) => void;
};

export function TaskRow({ task, sessions, busy, onToggle, onPatch, onSend, onDelete }: TaskRowProps) {
  const owner = sessions.find((s) => s.id === task.sessionId);
  const workspaceId = owner?.workspaceId ?? task.workspaceId;
  const paths = usePaths();
  return <li className="group hover:bg-muted/50 flex items-start gap-2 border-b px-3 py-2 last:border-0">
    <input type="checkbox" className="accent-primary mt-1 size-3.5 shrink-0" checked={task.status === "done"} disabled={busy} aria-label={`Mark ${task.title} ${task.status === "done" ? "open" : "done"}`} onChange={() => onToggle(task)} />
    <div className="min-w-0 flex-1">
      <button type="button" className={`w-full text-left text-[13px] break-words hover:underline ${task.status === "done" || task.status === "cancelled" ? "text-muted-foreground line-through" : ""}`} onClick={() => onPatch(task)}>{task.title}</button>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
        <span className="rounded border px-1">{TASK_STATUS_LABELS[task.status]}</span>
        {task.priority > 0 && <span title={`${["None", "Low", "Medium", "High"][task.priority]} priority`} aria-label={`${["None", "Low", "Medium", "High"][task.priority]} priority`} className={`size-1.5 rounded-full ${["", "bg-sky-500", "bg-amber-500", "bg-red-500"][task.priority]}`} />}
        {task.sessionId && <Link className="max-w-40 truncate hover:underline" href={workspaceId ? paths.session(workspaceId, task.sessionId) : `/s/${task.sessionId}`}>{owner?.origin?.kind === "worker" ? `Worker · ${owner.title || task.title}` : owner?.title || "Assigned session"}</Link>}
      </div>
    </div>
    <SendMenu compact label="Send" disabled={busy} sessions={sessions.filter((s) => s.live && (!task.workspaceId || s.workspaceId === task.workspaceId))} onPick={(id) => onSend(task, id)} />
    <Button size="icon-xs" variant="ghost" className="sm:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100" disabled={busy} aria-label={`Delete ${task.title}`} onClick={() => onDelete(task)}><Trash2Icon /></Button>
  </li>;
}
