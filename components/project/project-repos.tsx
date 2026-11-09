"use client";

import { FolderGit2Icon, FolderIcon, Loader2Icon, PlusIcon, Trash2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { api } from "@/lib/client/api";
import type { Project, ProjectRepo } from "@/lib/projects/types";
import { tildify } from "./form-fields";
import { draftReady, draftToSpec, emptyDraft, RepoSourceFields } from "./repo-source-form";

/** The repos and folders a project spans, with add and remove. */
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
      {project.repos.length === 0 && (
        <p className="text-muted-foreground text-xs">No repositories yet. Agents work in a scratch folder until you add one.</p>
      )}
      {project.repos.length > 0 && (
        <ul className="flex flex-col gap-1 text-xs">
          {project.repos.map((r) => (
            <RepoRow
              key={r.id}
              repo={r}
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
      )}
      {error && <p role="alert" className="text-destructive text-xs">{error}</p>}
      {project.repos.length > 1 && (
        <p className="text-muted-foreground text-xs">New workspaces get a worktree in each git repo on the same branch.</p>
      )}
      <div>
        <AddRepoDialog projectId={project.id} primary={project.repos.length === 0} />
      </div>
    </div>
  );
}

function RepoRow({ repo, action }: { repo: ProjectRepo; action?: React.ReactNode }) {
  const Icon = repo.kind === "repo" ? FolderGit2Icon : FolderIcon;
  return (
    <li className="flex items-center gap-2" title={repo.remote ?? repo.path}>
      <Icon className="text-muted-foreground size-3.5 shrink-0" />
      <span className="shrink-0 font-medium">{repo.name}</span>
      <span className="text-muted-foreground min-w-0 flex-1 truncate font-mono text-[11px]">{tildify(repo.path)}</span>
      <span className="text-muted-foreground shrink-0">{repo.kind === "repo" ? repo.defaultBranch : "folder"}</span>
      {action}
    </li>
  );
}

function AddRepoDialog({ projectId, primary }: { projectId: string; primary: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);
  const [pending, setPending] = useState(false);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setDraft(emptyDraft()); setError(null); setPending(false);
  };
  const canSubmit = !pending && !picking && draftReady(draft);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setPending(true);
    try {
      await api.addProjectRepo(projectId, draftToSpec(draft));
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
        <Button size="sm" variant={primary ? "default" : "outline"}><PlusIcon /> Add repo</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="contents">
          <DialogHeader>
            <DialogTitle>Add a repo to this project</DialogTitle>
            <DialogDescription>Workspaces will work across it alongside the project&apos;s other repos.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <RepoSourceFields draft={draft} onChange={setDraft} picking={picking} onPicking={setPicking} onError={setError} />
            {error && <p role="alert" className="text-destructive text-sm">{error}</p>}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={!canSubmit}>
              {pending && <Loader2Icon className="animate-spin" />}
              {draft.source === "github" ? (pending ? "Cloning…" : "Clone and add") : "Add repo"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
