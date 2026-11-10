"use client";

import { SaveIcon } from "lucide-react";
import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/client/api";
import type { HarvestData } from "@/lib/projects/harvest";

export type HarvestAction = "harvest" | "delete" | "merge";

export function HarvestDialog({ workspaceId, label, data, action, hasGit = false, onClose, onComplete }: {
  hasGit?: boolean; workspaceId: string; label: string; data: HarvestData; action: HarvestAction; onClose: () => void; onComplete: () => void;
}) {
  const [memory, setMemory] = useState(data.suggested);
  const [noteIds, setNoteIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [harvested, setHarvested] = useState(false);
  const verb = action === "merge" ? "merge and delete" : "delete";
  async function submit(keep: boolean) {
    setBusy(true); setError("");
    try {
      if (keep && !harvested) {
        await api.harvestWorkspace(workspaceId, { memory, noteIds });
        setHarvested(true);
      }
      if (action === "delete") {
        const result = await api.deleteWorkspace(workspaceId, { worktree: true });
        if (result.retainedDirectory) window.alert(`Files kept in ${result.retainedDirectory}`);
      }
      if (action === "merge") await api.workspaceGitAction(workspaceId, "merge", true);
      onComplete(); onClose();
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl" showCloseButton={!busy}>
      <DialogHeader><DialogTitle>Harvest · {label}</DialogTitle><DialogDescription>Copy what this workspace learned into the project: its task log into project memory, and chosen notes into project notes. Anything left behind is kept in the granary when the workspace is deleted.</DialogDescription></DialogHeader>
      {action === "merge" && <p className="text-sm">Merge committed changes into the local default branch, run the archive hook, then delete the worktree and sessions.</p>}
      {action === "delete" && <p className="text-sm">{hasGit ? "Delete this workspace, its sessions and worktree. Worktree deletion requires committed changes merged into the default branch." : "Delete this workspace and its sessions. Shared folders and non-empty scratch folders are kept."}</p>}
      <fieldset disabled={busy || harvested} className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div><p className="mb-2 text-sm font-medium">Workspace task log</p><pre className="bg-muted max-h-64 overflow-auto whitespace-pre-wrap rounded p-3 text-xs">{data.memory || "No task log yet."}</pre></div>
          <label className="text-sm font-medium">Keep in project memory<Textarea className="mt-2 min-h-48 font-mono text-xs" value={memory} onChange={e => setMemory(e.target.value)} /></label>
        </div>
        <fieldset><legend className="mb-2 text-sm font-medium">Move to project notes</legend>
          {data.notes.length ? data.notes.map(note => <label key={note.id} className="flex items-center gap-2 py-1 text-sm"><input type="checkbox" checked={noteIds.includes(note.id)} onChange={e => setNoteIds(ids => e.target.checked ? [...ids, note.id] : ids.filter(id => id !== note.id))} />{note.title}</label>) : <p className="text-muted-foreground text-sm">No workspace notes.</p>}
        </fieldset>
        <details><summary className="cursor-pointer text-sm">Project memory today</summary><pre className="bg-muted mt-2 max-h-48 overflow-auto whitespace-pre-wrap p-3 text-xs">{data.projectMemory || "No project memory yet."}</pre></details>
      </fieldset>
      {error && <p role="alert" className="text-destructive text-sm">{error}</p>}
      {harvested && <p role="status" className="text-sm">Harvest saved. Retrying will only {verb}.</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button>
        {action !== "harvest" && <Button variant="outline" disabled={busy} onClick={() => submit(false)}>{action === "merge" ? "Merge and delete" : "Delete"} without harvesting</Button>}
        <Button disabled={busy} onClick={() => submit(true)}>{busy ? "Working…" : action === "harvest" ? "Harvest" : `Harvest and ${verb}`}</Button>
      </div>
    </DialogContent>
  </Dialog>;
}

export function HarvestButton({ workspaceId, label }: { workspaceId: string; label: string }) {
  const router = useRouter();
  const [data, setData] = useState<HarvestData | null>(null);
  const [busy, setBusy] = useState(false);
  return <>
    <Button size="sm" variant="outline" disabled={busy} title="Copy this workspace's memory and notes into the project" onClick={async () => {
      setBusy(true);
      try { setData(await api.getHarvest(workspaceId)); } catch (err) { window.alert((err as Error).message); }
      finally { setBusy(false); }
    }}><SaveIcon /> Save to project</Button>
    {data && <HarvestDialog workspaceId={workspaceId} label={label} data={data} action="harvest" onClose={() => setData(null)} onComplete={() => router.refresh()} />}
  </>;
}

export function ArchivedHarvestOffer({ workspaceId, label }: { workspaceId: string; label: string }) {
  const router = useRouter();
  const pathname = usePathname();
  return <div role="status" className="fixed bottom-16 right-4 z-50 flex items-center gap-3 rounded border bg-background p-3 text-sm shadow-lg">
    {label} archived. <HarvestButton workspaceId={workspaceId} label={label} />
    <Button size="sm" variant="ghost" onClick={() => router.replace(pathname)}>Dismiss</Button>
  </div>;
}
