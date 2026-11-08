"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import type { SessionMeta } from "@/lib/agent/types";
import { TASK_STATUSES, TASK_STATUS_LABELS, type Task, type TaskPriority, type TaskStatus } from "@/lib/tasks/types";
import { scopeKey, type NoteMeta } from "@/lib/notes/types";
import { api } from "@/lib/client/api";

export type TaskDraft = Parameters<typeof api.createTask>[0];
export type TaskWorkspace = { id: string; name: string };

export function TaskSheet({ task, title: initialTitle = "", projectId, workspaceId, workspaces, sessions, onSave, onClose }: {
  task?: Task; title?: string; projectId: string; workspaceId?: string | null;
  workspaces: TaskWorkspace[]; sessions: SessionMeta[];
  onSave: (draft: TaskDraft) => Promise<void>; onClose: () => void;
}) {
  const [title, setTitle] = useState(task?.title ?? initialTitle);
  const [body, setBody] = useState(task?.body ?? "");
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? "open");
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? 0);
  const [scope, setScope] = useState(task ? task.workspaceId ?? "project" : workspaceId ?? "project");
  const [sessionId, setSessionId] = useState(task?.sessionId ?? "none");
  const [noteId, setNoteId] = useState(task?.noteId ?? "");
  const [dueAt, setDueAt] = useState(task?.dueAt?.slice(0, 10) ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedNotes, setLoadedNotes] = useState<{ scope: string; notes: NoteMeta[] } | null>(null);
  const available = sessions.filter((s) => (s.live || s.id === sessionId) && (scope === "project" || s.workspaceId === scope));
  const notes = loadedNotes?.scope === scope ? loadedNotes.notes : [];
  useEffect(() => {
    let cancelled = false;
    const request = scope === "project" ? api.listNotes("projects", projectId) : api.listNotes("workspaces", scope);
    request.then((r) => !cancelled && setLoadedNotes({ scope, notes: r.notes })).catch((err: Error) => !cancelled && setError(err.message));
    return () => { cancelled = true; };
  }, [projectId, scope]);
  const save = async () => {
    if (busy || !title.trim()) return;
    setBusy(true); setError(null);
    try {
      await onSave({ projectId, title: title.trim(), body: body || null, status, priority, workspaceId: scope === "project" ? null : scope, sessionId: sessionId === "none" ? null : sessionId, noteId: noteId || null, dueAt: dueAt === task?.dueAt?.slice(0, 10) ? task.dueAt : dueAt ? new Date(`${dueAt}T00:00:00Z`).toISOString() : null });
      onClose();
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };
  return <Sheet open onOpenChange={(open) => !open && !busy && onClose()}>
    <SheetContent className="w-[min(600px,92vw)] overflow-y-auto p-5 data-[side=right]:sm:max-w-none">
      <SheetTitle>{task ? "Edit task" : "New task"}</SheetTitle>
      <SheetDescription>Track the work and the session responsible for it.</SheetDescription>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void save(); }} onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) { e.preventDefault(); void save(); } }}>
        <fieldset disabled={busy} className="space-y-4">
          <label className="grid gap-1.5 text-xs">Title<Input autoFocus required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
          <label className="grid gap-1.5 text-xs">Details (Markdown)<Textarea rows={8} maxLength={20000} value={body} onChange={(e) => setBody(e.target.value)} /></label>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5 text-xs">Status<Select value={status} onValueChange={(v) => setStatus(v as TaskStatus)}><SelectTrigger aria-label="Status" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{TASK_STATUSES.map((s) => <SelectItem key={s} value={s}>{TASK_STATUS_LABELS[s]}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1.5 text-xs">Priority<Select value={String(priority)} onValueChange={(v) => setPriority(Number(v) as TaskPriority)}><SelectTrigger aria-label="Priority" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{["None", "Low", "Medium", "High"].map((p, i) => <SelectItem key={p} value={String(i)}>{p}</SelectItem>)}</SelectContent></Select></div>
          </div>
          <div className="space-y-1.5 text-xs">Scope<Select value={scope} onValueChange={(v) => { setScope(v); setSessionId("none"); setNoteId(""); }}><SelectTrigger aria-label="Task scope" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="project">Project</SelectItem>{workspaces.map((w) => <SelectItem key={w.id} value={w.id}>Workspace · {w.name}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1.5 text-xs">Owner<Select value={sessionId} onValueChange={setSessionId}><SelectTrigger aria-label="Owner session" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Unassigned</SelectItem>{sessionId !== "none" && !available.some((s) => s.id === sessionId) && <SelectItem value={sessionId}>Assigned session</SelectItem>}{available.map((s) => <SelectItem key={s.id} value={s.id}>{s.title || "Untitled session"}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1.5 text-xs">Linked note<Select value={noteId || "none"} onValueChange={(v) => setNoteId(v === "none" ? "" : v)}><SelectTrigger aria-label="Linked note" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">None</SelectItem>{noteId && !notes.some((n) => n.id === noteId) && <SelectItem value={noteId}>Linked note</SelectItem>}{notes.map((n) => <SelectItem key={n.id} value={n.id}>{n.title || "Untitled note"}</SelectItem>)}</SelectContent></Select></div>
          {noteId && <Link className="text-xs underline" href={`/notes?${new URLSearchParams({ scope: scopeKey({ kind: scope === "project" ? "projects" : "workspaces", id: scope === "project" ? projectId : scope }), note: noteId })}`}>Open linked note</Link>}
          <label className="grid gap-1.5 text-xs">Due date<Input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} /></label>
        </fieldset>
        {error && <p role="alert" className="text-destructive text-xs">{error}</p>}
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy || !title.trim()}>{busy ? "Saving…" : "Save task"}</Button></div>
      </form>
    </SheetContent>
  </Sheet>;
}
