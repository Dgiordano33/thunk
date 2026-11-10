"use client";
import { Loader2Icon, SearchIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/client/api";

type FileOption = Awaited<ReturnType<typeof api.listRepoFolderFiles>>["files"][number];

/**
 * Pick which Markdown files in a repo folder show up as editable notes.
 * Picking every file keeps the whole folder, so files added later appear too.
 */
export function RepoFilePicker({
  projectId,
  target,
  onClose,
  onSaved,
}: {
  projectId: string;
  /** The folder to pick from; `folderId` and `files` are set when editing an existing notebook. */
  target: { repoId: string; repoName: string; path: string; folderId?: string; files?: string[] | null } | null;
  onClose: () => void;
  onSaved: (folderId: string) => void;
}) {
  const [files, setFiles] = useState<FileOption[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!target) return;
    let active = true;
    setFiles(null); setQuery(""); setError(null);
    api.listRepoFolderFiles(projectId, { repoId: target.repoId, path: target.path }).then(({ files }) => {
      if (!active) return;
      setFiles(files);
      // Editing keeps the current picks; a new notebook starts empty so the choice is deliberate.
      setSelected(new Set(target.folderId ? (target.files ?? files.map((f) => f.id)) : []));
    }).catch((err: Error) => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [projectId, target]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return !files ? [] : q ? files.filter((f) => f.title.toLowerCase().includes(q) || f.id.toLowerCase().includes(q)) : files;
  }, [files, query]);
  const allVisibleSelected = visible.length > 0 && visible.every((f) => selected.has(f.id));
  const allSelected = !!files?.length && files.every((f) => selected.has(f.id));

  const toggle = (id: string) => setSelected((s) => { const next = new Set(s); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const toggleVisible = () => setSelected((s) => {
    const next = new Set(s);
    for (const f of visible) if (allVisibleSelected) next.delete(f.id); else next.add(f.id);
    return next;
  });

  const save = async () => {
    if (!target || !files) return;
    setBusy(true); setError(null);
    // Keep the folder's own order so the notebook lists files predictably.
    const picks = allSelected ? null : files.filter((f) => selected.has(f.id)).map((f) => f.id);
    try {
      if (target.folderId) {
        await api.setRepoFolderFiles(projectId, target.folderId, picks);
        onSaved(target.folderId);
      } else {
        const { folder } = await api.addRepoFolder(projectId, { repoId: target.repoId, path: target.path, files: picks });
        onSaved(folder.id);
      }
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open={!!target} onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent className="flex max-h-[80vh] flex-col gap-3 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{target?.folderId ? "Choose files" : "Add files to project notes"}</DialogTitle>
          <DialogDescription>
            {target?.repoName} / {target?.path}. Picked files open as editable notes; edits save to the files in the repo.
          </DialogDescription>
        </DialogHeader>
        {files && files.length > 6 && (
          <div className="relative">
            <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
            <Input aria-label="Filter files" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter files" className="h-8 pl-7 text-xs" />
          </div>
        )}
        <div className="min-h-24 flex-1 overflow-y-auto rounded-xs border">
          {files === null && !error && <div className="text-muted-foreground flex items-center justify-center gap-2 p-6 text-xs"><Loader2Icon className="size-3.5 animate-spin" />Loading files…</div>}
          {files?.length === 0 && <p className="text-muted-foreground p-6 text-center text-xs">No Markdown files in this folder yet.</p>}
          {files && files.length > 0 && (
            <ul className="divide-y text-xs">
              <li className="bg-muted/40 sticky top-0">
                <label className="flex cursor-pointer items-center gap-2 px-3 py-2 font-medium">
                  <input type="checkbox" className="accent-(--w-bronze)" checked={allVisibleSelected} onChange={toggleVisible} />
                  {query ? `Select ${visible.length} matching` : "Select all"}
                  <span className="text-muted-foreground ml-auto font-normal tabular-nums">{selected.size} of {files.length}</span>
                </label>
              </li>
              {visible.map((f) => (
                <li key={f.id}>
                  <label className="hover:bg-muted/60 flex cursor-pointer items-center gap-2 px-3 py-1.5">
                    <input type="checkbox" className="accent-(--w-bronze)" checked={selected.has(f.id)} onChange={() => toggle(f.id)} />
                    <span className="min-w-0 flex-1 truncate">{f.title}</span>
                    <span className="text-muted-foreground shrink-0 font-mono text-[11px]">{f.id}.md</span>
                  </label>
                </li>
              ))}
              {visible.length === 0 && <li className="text-muted-foreground px-3 py-4 text-center">No files match “{query}”.</li>}
            </ul>
          )}
        </div>
        {allSelected && <p className="text-muted-foreground text-xs">All files picked: new files in this folder will show up too.</p>}
        {error && <p role="alert" className="text-destructive text-xs">{error}</p>}
        <DialogFooter>
          <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={busy || !files || selected.size === 0} onClick={() => void save()}>
            {busy && <Loader2Icon className="animate-spin" />}
            {target?.folderId ? "Save" : `Add ${selected.size || ""} ${selected.size === 1 ? "file" : "files"}`.replace("  ", " ")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
