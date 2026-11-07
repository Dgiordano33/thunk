"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client/api";
import type { Checkpoint } from "@/lib/projects/checkpoints";
import { useSession } from "@/lib/store/session-store";

export function Checkpoints({ workspaceId, onRestore }: { workspaceId: string; onRestore: () => void }) {
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const status = useSession((s) => s.status);
  const load = useCallback(() => api.checkpoints(workspaceId).then((r) => setCheckpoints(r.checkpoints)).catch((err: Error) => setError(err.message)), [workspaceId]);
  useEffect(() => {
    void load();
    const timer = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 5000);
    return () => clearInterval(timer);
  }, [load, status]);
  const running = ["starting", "running", "awaiting"].includes(status);
  return <div className="flex flex-col gap-3 p-3 text-xs">
    <p className="text-muted-foreground">Snapshots before each prompt runs in Git workspaces. Rewind restores files; chat history, commits, and staging stay unchanged. Ignored files are excluded. Stop agents and any processes editing files first.</p>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {!checkpoints.length && <p>No checkpoints yet.</p>}
    {checkpoints.map((c) => <div key={c.id} className="rounded-md border p-3">
      <p className="truncate font-medium" title={c.label}>{c.label}</p>
      <p className="mt-1 text-muted-foreground">{new Date(c.createdAt).toLocaleString()}</p>
      {selected === c.id ? <div className="mt-2 flex flex-col gap-2">
        <p>Replace the working tree with this snapshot? A recovery checkpoint will be saved first. The agent keeps its existing conversation context.</p>
        <div className="flex gap-2"><Button size="xs" disabled={busy || running} onClick={async () => {
          setBusy(true); setError(null);
          try { await api.rewind(workspaceId, c.id); setSelected(null); await load(); onRestore(); }
          catch (err) { setError((err as Error).message); }
          finally { setBusy(false); }
        }}>{busy ? "Restoring…" : "Restore files"}</Button><Button size="xs" variant="ghost" disabled={busy} onClick={() => setSelected(null)}>Cancel</Button></div>
      </div> : <Button className="mt-2" size="xs" variant="outline" disabled={busy || running} onClick={() => setSelected(c.id)}>Rewind here</Button>}
    </div>)}
  </div>;
}
