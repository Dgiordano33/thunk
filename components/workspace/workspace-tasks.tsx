"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { TaskBoard } from "@/components/tasks/task-board";
import { refreshTasks } from "@/components/tasks/use-tasks";
import { api } from "@/lib/client/api";

export function WorkspaceTasks({ workspaceId, projectId }: { workspaceId: string; projectId: string }) {
  return <><ImportNotes key={workspaceId} workspaceId={workspaceId} /><TaskBoard key={workspaceId} projectId={projectId} workspaceId={workspaceId} /></>;
}

function ImportNotes({ workspaceId }: { workspaceId: string }) {
  const key = `thunk:tasks:import-dismissed:${workspaceId}`;
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    try { if (localStorage.getItem(key)) return; } catch { /* Storage can be unavailable in private browsing. */ }
    let cancelled = false;
    api.taskImportCount(workspaceId).then((r) => !cancelled && setCount(r.count)).catch((err: Error) => !cancelled && setError(err.message));
    return () => { cancelled = true; };
  }, [key, workspaceId]);
  const dismiss = () => {
    setCount(0);
    try { localStorage.setItem(key, "1"); } catch { /* Dismiss still applies for this mount. */ }
  };
  const importNotes = async () => {
    setBusy(true); setError(null);
    try { await api.importNoteTasks(workspaceId); dismiss(); refreshTasks(); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };
  return <>
    {count > 0 && <div className="border-b bg-muted/40 p-3 text-xs"><p>Import {count} checklist items from notes</p><p className="mt-1 text-muted-foreground">Your note text stays unchanged.</p><div className="mt-2 flex gap-2"><Button size="xs" disabled={busy} onClick={() => void importNotes()}>{busy ? "Importing…" : "Import"}</Button><Button size="xs" variant="ghost" disabled={busy} onClick={dismiss}>Dismiss</Button></div></div>}
    {error && <p role="alert" className="text-destructive p-3 text-xs">{error}</p>}
  </>;
}
