"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/lib/client/api";
import type { Project } from "@/lib/projects/types";
import { useNotesFeed } from "@/lib/store/notes-store";

export function RepoNotebooks({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [suggestions, setSuggestions] = useState<Awaited<ReturnType<typeof api.suggestRepoFolders>>["candidates"]>([]);
  const [repoId, setRepoId] = useState("primary");
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rev, setRev] = useState(0);
  useEffect(() => {
    let active = true;
    Promise.all([api.getProject(projectId), api.suggestRepoFolders(projectId)]).then(([p, s]) => {
      if (active) { setProject(p.project); setSuggestions(s.candidates); }
    }).catch((err: Error) => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [projectId, rev]);
  const change = async (operation: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await operation(); setRev((n) => n + 1); useNotesFeed.getState().touch({ kind: "projects", id: projectId }); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };
  return <details className="border-b p-3 text-xs"><summary className="cursor-pointer font-medium">Repo notebooks</summary>
    <div className="mt-2 space-y-2">
      <p className="text-muted-foreground">Read and edit Markdown in the registered main checkout. Removing a notebook leaves its files on disk. Folders declared in thunk.json are re-added while listed there.</p>
      {project?.repoFolders.map((f) => <div key={f.id} className="flex items-center gap-2">
        <Link className="min-w-0 flex-1 truncate underline" href={`/notes?scope=r:${f.id}`}>{f.repoId ? `${project.extraRepos.find((r) => r.id === f.repoId)?.name} / ` : ""}{f.label}</Link>
        <Button size="xs" variant="ghost" disabled={busy} onClick={() => void change(() => api.removeRepoFolder(projectId, f.id))}>Remove</Button>
      </div>)}
      {suggestions.map((s) => <div key={`${s.repoId}:${s.path}`} className="flex items-center gap-2"><span className="flex-1">{s.repoName} / {s.path} · {s.count} files</span><Button size="xs" variant="outline" disabled={busy} onClick={() => void change(() => api.addRepoFolder(projectId, s))}>Add</Button></div>)}
      <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); void change(() => api.addRepoFolder(projectId, { repoId: repoId === "primary" ? null : repoId, path })); }}>
        <Select value={repoId} onValueChange={setRepoId}><SelectTrigger aria-label="Repository" className="w-40"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="primary">Primary repo</SelectItem>{project?.extraRepos.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent></Select>
        <Input aria-label="Notebook folder path" value={path} onChange={(e) => setPath(e.target.value)} placeholder="Existing folder, e.g. docs" required className="min-w-40 flex-1" />
        <Button size="sm" disabled={busy || !path.trim()}>Add folder</Button>
      </form>
      {error && <p role="alert" className="text-destructive">{error}</p>}
    </div>
  </details>;
}
