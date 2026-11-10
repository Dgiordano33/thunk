"use client";
import Link from "next/link";
import { useEffect, useState, type ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/lib/client/api";
import type { Project } from "@/lib/projects/types";
import { useNotesFeed } from "@/lib/store/notes-store";
import { RepoFilePicker } from "./repo-file-picker";

export type RepoNotebookOption = { id: string; label: string };

export function RepoNotebooks({ projectId, onOpen, onFolders }: {
  projectId: string;
  /** Show a notebook's notes, e.g. right after its files were picked. Without it, notebooks link to the Library page. */
  onOpen?: (folderId: string) => void;
  onFolders?: (folders: RepoNotebookOption[]) => void;
}) {
  const [picking, setPicking] = useState<ComponentProps<typeof RepoFilePicker>["target"]>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [suggestions, setSuggestions] = useState<Awaited<ReturnType<typeof api.suggestRepoFolders>>["candidates"]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rev, setRev] = useState(0);
  useEffect(() => {
    let active = true;
    Promise.all([api.getProject(projectId), api.suggestRepoFolders(projectId)]).then(([p, s]) => {
      if (!active) return;
      setProject(p.project); setSuggestions(s.candidates);
      onFolders?.(p.project.repoFolders.map((f) => ({ id: f.id, label: `${p.project.repos.find((r) => r.id === f.repoId)?.name} / ${f.label}` })));
    }).catch((err: Error) => { if (active) setError(err.message); });
    return () => { active = false; };
    // onFolders is a notification; re-running on its identity would refetch every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, rev]);
  const change = async (operation: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await operation(); setRev((n) => n + 1); useNotesFeed.getState().touch({ kind: "projects", id: projectId }); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };
  const repoId = picked ?? project?.repos[0]?.id ?? "";
  const repoName = (id: string) => project?.repos.find((r) => r.id === id)?.name ?? "";
  const saved = (folderId: string) => {
    setPicking(null); setPath(""); setRev((n) => n + 1);
    useNotesFeed.getState().touch({ kind: "projects", id: projectId });
    useNotesFeed.getState().touch({ kind: "repos", id: folderId });
    onOpen?.(folderId);
  };
  return <details className="border-b p-3 text-xs"><summary className="cursor-pointer font-medium">Repo notebooks</summary>
    <div className="mt-2 space-y-2">
      <p className="text-muted-foreground">Pick Markdown files from a repo to read and edit them as notes. Edits save to the files in the registered main checkout; removing a notebook leaves its files on disk. Folders declared in thunk.json are re-added while listed there.</p>
      {project?.repoFolders.map((f) => <div key={f.id} className="flex items-center gap-2">
        {onOpen
          ? <button type="button" className="min-w-0 flex-1 truncate text-left underline" onClick={() => onOpen(f.id)}>{repoName(f.repoId)} / {f.label}</button>
          : <Link className="min-w-0 flex-1 truncate underline" href={`/notes?scope=r:${f.id}`}>{repoName(f.repoId)} / {f.label}</Link>}
        <span className="text-muted-foreground shrink-0">{f.files ? `${f.files.length} ${f.files.length === 1 ? "file" : "files"}` : "All files"}</span>
        <Button size="xs" variant="ghost" disabled={busy} onClick={() => setPicking({ repoId: f.repoId, repoName: repoName(f.repoId), path: f.path, folderId: f.id, files: f.files })}>Files</Button>
        <Button size="xs" variant="ghost" disabled={busy} onClick={() => void change(() => api.removeRepoFolder(projectId, f.id))}>Remove</Button>
      </div>)}
      {suggestions.map((s) => <div key={`${s.repoId}:${s.path}`} className="flex items-center gap-2"><span className="flex-1">{s.repoName} / {s.path} · {s.count} files</span><Button size="xs" variant="outline" disabled={busy || !s.repoId} onClick={() => s.repoId && setPicking({ repoId: s.repoId, repoName: s.repoName, path: s.path })}>Add…</Button></div>)}
      {project && project.repos.length > 0 && <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); setPicking({ repoId, repoName: repoName(repoId), path: path.trim() }); }}>
        <Select value={repoId} onValueChange={setPicked}><SelectTrigger aria-label="Repository" className="w-40"><SelectValue /></SelectTrigger><SelectContent>{project.repos.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent></Select>
        <Input aria-label="Notebook folder path" value={path} onChange={(e) => setPath(e.target.value)} placeholder="Existing folder, e.g. docs" required className="min-w-40 flex-1" />
        <Button size="sm" disabled={busy || !path.trim()}>Choose files…</Button>
      </form>}
      {error && <p role="alert" className="text-destructive">{error}</p>}
    </div>
    <RepoFilePicker projectId={projectId} target={picking} onClose={() => setPicking(null)} onSaved={saved} />
  </details>;
}
