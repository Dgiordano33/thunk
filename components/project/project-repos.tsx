"use client";

import { FolderGit2Icon, GitForkIcon, Loader2Icon, PlusIcon, Trash2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Field, FolderPicker } from "@/components/home/add-project-form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/client/api";
import type { Project } from "@/lib/projects/types";
import { cn } from "@/lib/utils";

const tildify = (p: string) => p.replace(/^\/Users\/[^/]+/, "~");

/** The git repos a project spans: its primary root plus any added repos, with add and remove. */
export function ProjectRepos({ project }: { project: Project }) {
  const router = useRouter();
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const remove = async (id: string, name: string) => {
    if (!window.confirm(`Remove ${name} from ${project.name}? Its checkout on disk is left alone.`)) return;
    setRemoving(id);
    setError(null);
    try {
      await api.removeProjectRepo(project.id, id);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRemoving(null);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-1 text-xs">
        <RepoRow name={project.name} path={project.root} note={project.kind === "repo" ? "primary" : "folder"} />
        {project.extraRepos.map((r) => (
          <RepoRow
            key={r.id}
            name={r.name}
            path={r.path}
            note={r.defaultBranch ?? undefined}
            action={
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={`Remove ${r.name}`}
                title="Remove from project"
                disabled={removing !== null}
                onClick={() => void remove(r.id, r.name)}
              >
                {removing === r.id ? <Loader2Icon className="animate-spin" /> : <Trash2Icon />}
              </Button>
            }
          />
        ))}
      </ul>
      {error && <p role="alert" className="text-destructive text-xs">{error}</p>}
      {project.extraRepos.length > 0 && (
        <p className="text-muted-foreground text-xs">New workspaces get a worktree in each repo on the same branch.</p>
      )}
      <div>
        <AddRepoDialog projectId={project.id} />
      </div>
    </div>
  );
}

function RepoRow({ name, path, note, action }: { name: string; path: string; note?: string; action?: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2" title={path}>
      <FolderGit2Icon className="text-muted-foreground size-3.5 shrink-0" />
      <span className="shrink-0 font-medium">{name}</span>
      <span className="text-muted-foreground min-w-0 flex-1 truncate font-mono text-[11px]">{tildify(path)}</span>
      {note && <span className="text-muted-foreground shrink-0">{note}</span>}
      {action}
    </li>
  );
}

const DEFAULT_PARENT = "~/code";

function AddRepoDialog({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<"folder" | "github">("folder");
  const [path, setPath] = useState("");
  const [url, setUrl] = useState("");
  const [parent, setParent] = useState(DEFAULT_PARENT);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setSource("folder"); setPath(""); setUrl(""); setParent(DEFAULT_PARENT); setName(""); setError(null); setPending(false);
  };
  const pick = async (prompt: string, current: string, set: (p: string) => void) => {
    setError(null);
    setPicking(true);
    try {
      const picked = (await api.pickFolder({ prompt, defaultPath: current || undefined })).path;
      if (picked) set(picked);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPicking(false);
    }
  };
  const canSubmit = !pending && !picking && (source === "folder" ? !!path.trim() : !!url.trim() && !!parent.trim());

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setPending(true);
    try {
      const label = name.trim() || undefined;
      await api.addProjectRepo(projectId, source === "folder" ? { path, name: label } : { source, url, parent, name: label });
      setOpen(false);
      reset();
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (pending || picking) return; setOpen(next); if (!next) reset(); }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline"><PlusIcon /> Add repo</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="contents">
          <DialogHeader>
            <DialogTitle>Add a repo to this project</DialogTitle>
            <DialogDescription>Workspaces will work across it alongside the project&apos;s other repos.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex gap-1 rounded-lg border p-0.5" role="radiogroup" aria-label="Repo source">
              {(["folder", "github"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={source === s}
                  onClick={() => setSource(s)}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors",
                    source === s ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {s === "folder" ? <FolderGit2Icon className="size-3.5" /> : <GitForkIcon className="size-3.5" />}
                  {s === "folder" ? "Existing checkout" : "Clone from GitHub"}
                </button>
              ))}
            </div>
            {source === "folder" ? (
              <Field label="Repo folder" hint="Any folder inside the repo works; its main checkout is used.">
                <FolderPicker value={path} picking={picking} onPick={() => void pick("Choose a git repo", path, setPath)} />
              </Field>
            ) : (
              <>
                <Field label="Repository URL" hint="HTTPS, SSH, or owner/repo shorthand.">
                  <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/owner/repo" className="font-mono text-sm" autoFocus />
                </Field>
                <Field label="Clone into">
                  <FolderPicker value={parent} picking={picking} onPick={() => void pick("Choose where to clone the repo", parent, setParent)} />
                </Field>
              </>
            )}
            <Field label="Name (optional)" hint="How agents and the UI refer to it. Defaults to the folder name.">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="api" className="font-mono text-sm" />
            </Field>
            {error && <p role="alert" className="text-destructive text-sm">{error}</p>}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={!canSubmit}>
              {pending && <Loader2Icon className="animate-spin" />}
              {source === "github" ? (pending ? "Cloning…" : "Clone and add") : "Add repo"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
