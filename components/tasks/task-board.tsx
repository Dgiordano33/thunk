"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/client/api";
import type { SessionMeta } from "@/lib/agent/types";
import type { Task } from "@/lib/tasks/types";
import { NewTaskInput } from "./new-task-input";
import { TaskList } from "./task-list";
import { TaskSheet, type TaskDraft, type TaskWorkspace } from "./task-sheet";
import { refreshTasks, useScopeTasks } from "./use-tasks";

export function TaskBoard({ projectId, workspaceId, workspaces: initialWorkspaces = [] }: { projectId: string; workspaceId?: string; workspaces?: TaskWorkspace[] }) {
  const router = useRouter();
  const { tree, tasks, projectTasks, error: loadError } = useScopeTasks({ projectId, workspaceId });
  const [scope, setScope] = useState(workspaceId ?? "project");
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [inputVersion, setInputVersion] = useState(0);
  const [editor, setEditor] = useState<{ task?: Task; title?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [sending, setSending] = useState<Task | null>(null);
  const [destination, setDestination] = useState("");
  const workspaces = tree?.workspaces.map((w) => w.workspace) ?? initialWorkspaces;
  useEffect(() => {
    let cancelled = false;
    api.listSessions({ projectId }).then((r) => !cancelled && setSessions(r.sessions)).catch((err: Error) => !cancelled && setError(err.message));
    return () => { cancelled = true; };
  }, [projectId, tree]);
  const run = async (id: string, action: () => Promise<unknown>) => {
    if (busyId) return;
    setBusyId(id); setError(null);
    try { await action(); refreshTasks(); }
    catch (err) { setError((err as Error).message); }
    finally { setBusyId(null); }
  };
  const create = async (draft: TaskDraft) => { await api.createTask(draft); refreshTasks(); };
  const send = (task: Task, sessionId: string | null, targetWorkspace?: string) => {
    const ws = targetWorkspace ?? task.workspaceId ?? workspaceId;
    if (!sessionId && !ws) { setDestination(workspaces[0]?.id ?? ""); setSending(task); return; }
    void run(task.id, async () => {
      const result = await api.sendTask(task.id, sessionId === "worker" ? { worker: true } : sessionId ? { sessionId } : { workspaceId: ws });
      setSending(null);
      router.push(result.href); router.refresh();
    });
  };
  const list = (items: Task[], emptyText: string) => <TaskList tasks={items} sessions={sessions} busyId={busyId} emptyText={emptyText}
    onToggle={(task) => void run(task.id, () => api.patchTask(task.id, { status: task.status === "done" ? "open" : "done" }))}
    onPatch={(task) => setEditor({ task })} onSend={send}
    onDelete={(task) => { if (window.confirm(`Delete “${task.title}”?`)) void run(task.id, () => api.deleteTask(task.id)); }} />;
  return <div className="pb-4">
    <div className="space-y-2 border-b p-3">
      {!workspaceId && <Select value={scope} onValueChange={setScope}><SelectTrigger aria-label="New task scope" className="w-full" size="sm"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="project">Project</SelectItem>{workspaces.map((w) => <SelectItem key={w.id} value={w.id}>Workspace · {w.name}</SelectItem>)}</SelectContent></Select>}
      <NewTaskInput key={inputVersion} onCreate={(title) => create({ projectId, workspaceId: scope === "project" ? null : scope, title })} onEdit={(title) => setEditor({ title })} />
    </div>
    {(error || loadError) && <p role="alert" className="text-destructive p-3 text-xs">{error || loadError}<Button size="xs" variant="ghost" onClick={refreshTasks}>Retry</Button></p>}
    {!tree && !loadError && <p role="status" className="text-muted-foreground p-3 text-xs">Loading tasks…</p>}
    {tree && (workspaceId ? <>
      {list(tasks, "No workspace tasks yet.")}
      <details className="border-t"><summary className="cursor-pointer px-3 py-2 text-xs font-medium">Project tasks ({projectTasks.length})</summary>{list(projectTasks, "No project tasks yet.")}</details>
    </> : <>
      <h2 className="px-3 pt-3 text-xs font-medium">Project tasks</h2>{list(projectTasks, "No project tasks yet.")}
      {tree.workspaces.map(({ workspace, tasks: items }) => <details key={workspace.id} open className="border-t"><summary className="cursor-pointer px-3 py-2 text-xs font-medium">{workspace.name} ({items.length})</summary>{list(items, "No tasks in this workspace.")}</details>)}
    </>)}
    {editor && <TaskSheet task={editor.task} title={editor.title} projectId={projectId} workspaceId={scope === "project" ? null : scope} workspaces={workspaces} sessions={sessions} onClose={() => setEditor(null)} onSave={async (draft) => {
      if (editor.task) {
        const original = editor.task;
        // Save only edited fields so an agent's concurrent status/owner change survives.
        const patch = Object.fromEntries(Object.entries(draft).filter(([key, value]) => key !== "projectId" && value !== original[key as keyof Task]));
        if (Object.keys(patch).length) await api.patchTask(original.id, patch);
        refreshTasks();
      } else { await create(draft); setInputVersion((v) => v + 1); }
    }} />}
    <Dialog open={!!sending} onOpenChange={(open) => !open && !busyId && setSending(null)}><DialogContent>
      <DialogTitle>Send task to a new chat</DialogTitle><DialogDescription>Choose the workspace where the session should work.</DialogDescription>
      <Select value={destination} onValueChange={setDestination}><SelectTrigger aria-label="Destination workspace" className="w-full"><SelectValue placeholder="Choose workspace" /></SelectTrigger><SelectContent>{workspaces.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent></Select>
      {!workspaces.length && <p className="text-xs text-muted-foreground">Create a workspace before starting a chat.</p>}
      {error && <p role="alert" className="text-destructive text-xs">{error}</p>}
      <Button disabled={!destination || !!busyId} onClick={() => sending && send(sending, null, destination)}>{busyId ? "Sending…" : "Start chat"}</Button>
    </DialogContent></Dialog>
  </div>;
}
