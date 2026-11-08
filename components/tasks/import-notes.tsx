"use client";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client/api";
import type { NoteImportScope } from "@/lib/tasks/types";
import { useNotesEvents, useNotesFeed } from "@/lib/store/notes-store";
import { refreshTasks } from "./use-tasks";

export function ImportNotes({ workspaceId, projectId = "" }: { workspaceId?: string; projectId?: string }) {
  useNotesEvents();
  const notesRev = useNotesFeed((s) => s.rev);
  const scope = useMemo<NoteImportScope>(() => workspaceId ? { workspaceId } : { projectId }, [workspaceId, projectId]);
  const key = `thunk:tasks:import-dismissed:${workspaceId ?? projectId}`;
  const [folders, setFolders] = useState<string[]>([]);
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    api.taskImportCount(scope).then((r) => {
      if (cancelled) return;
      try { if (!r.folders.length && localStorage.getItem(key)) return; } catch { /* Storage can be unavailable. */ }
      setCount(r.count); setFolders(r.folders);
    }).catch((err: Error) => !cancelled && setError(err.message));
    return () => { cancelled = true; };
  }, [key, scope, notesRev]);
  const dismiss = () => {
    setCount(0);
    try { localStorage.setItem(key, "1"); } catch { /* Dismiss still applies for this mount. */ }
  };
  const importNotes = async () => {
    setBusy(true); setError(null);
    try { await api.importNoteTasks(scope); dismiss(); refreshTasks(); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };
  return <>
    {count > 0 && <div className="border-b bg-muted/40 p-3 text-xs"><p>Import {count} checklist items from notes{folders.length ? `, including ${folders.join(", ")}` : ""}</p><p className="mt-1 text-muted-foreground">Repo board checkboxes follow task status after import.</p><div className="mt-2 flex gap-2"><Button size="xs" disabled={busy} onClick={() => void importNotes()}>{busy ? "Importing…" : "Import"}</Button><Button size="xs" variant="ghost" disabled={busy} onClick={dismiss}>Dismiss</Button></div></div>}
    {error && <p role="alert" className="text-destructive p-3 text-xs">{error}</p>}
  </>;
}
