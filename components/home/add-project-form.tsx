"use client";

import { ArrowLeftIcon, ChevronRightIcon, FolderIcon, FolderOpenIcon, FolderPlusIcon, GitForkIcon, Loader2Icon, PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/utils";

type Source = "github" | "folder" | "new";

const DEFAULT_PARENT = "~/code";

const OPTIONS: { source: Source; icon: typeof FolderOpenIcon; title: string; description: string }[] = [
  {
    source: "github",
    icon: GitForkIcon,
    title: "Clone from GitHub",
    description: "Paste a repo URL and Thunk downloads it for you.",
  },
  {
    source: "folder",
    icon: FolderOpenIcon,
    title: "Open an existing folder",
    description: "Point at a repo or folder already on this machine.",
  },
  {
    source: "new",
    icon: FolderPlusIcon,
    title: "Start a new folder",
    description: "Create an empty folder, optionally as a git repo.",
  },
];

export function AddProjectForm({ size = "default" }: { size?: "default" | "lg" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<Source | null>(null);
  const [path, setPath] = useState("");
  const [url, setUrl] = useState("");
  const [parent, setParent] = useState(DEFAULT_PARENT);
  const [name, setName] = useState("");
  const [initGit, setInitGit] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [picking, setPicking] = useState(false);

  const reset = () => {
    setSource(null);
    setPath("");
    setUrl("");
    setParent(DEFAULT_PARENT);
    setName("");
    setInitGit(true);
    setError(null);
    setPending(false);
  };

  const onOpenChange = (next: boolean) => {
    if (pending || picking) return;
    setOpen(next);
    if (!next) reset();
  };

  const canSubmit =
    !pending &&
    (source === "folder"
      ? !!path.trim()
      : source === "github"
        ? !!url.trim() && !!parent.trim()
        : !!name.trim() && !!parent.trim());

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!source || !canSubmit) return;
    setError(null);
    setPending(true);
    try {
      const { project } = await api.addProject(
        source === "folder"
          ? { source, path }
          : source === "github"
            ? { source, url, parent }
            : { source, parent, name, git: initGit },
      );
      router.push(`/p/${project.id}`);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setPending(false);
    }
  };

  /** Open the native folder picker; resolves to the chosen path, or null if cancelled. */
  const pickFolder = async (prompt: string, defaultPath?: string) => {
    setError(null);
    setPicking(true);
    try {
      return (await api.pickFolder({ prompt, defaultPath })).path;
    } catch (err) {
      setError((err as Error).message);
      return null;
    } finally {
      setPicking(false);
    }
  };

  const choose = async (next: Source) => {
    if (next !== "folder") return setSource(next);
    // Existing folder goes straight to Finder; only show the confirm step once something is picked.
    const picked = await pickFolder("Choose a project folder", path || undefined);
    if (picked) {
      setPath(picked);
      setSource("folder");
    }
  };

  const option = OPTIONS.find((o) => o.source === source);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size={size}>
          <PlusIcon />
          Add project
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        {!option ? (
          <>
            <DialogHeader>
              <DialogTitle>Add a project</DialogTitle>
              <DialogDescription>Where should this project come from?</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2">
              {OPTIONS.map(({ source, icon: Icon, title, description }) => (
                <button
                  key={source}
                  type="button"
                  onClick={() => choose(source)}
                  disabled={picking}
                  className="group hover:bg-muted focus-visible:ring-ring flex items-center gap-3 rounded-lg border p-3 text-left transition-colors outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-60"
                >
                  <span className="bg-muted text-muted-foreground group-hover:bg-background group-hover:text-foreground flex size-9 shrink-0 items-center justify-center rounded-md transition-colors">
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{title}</span>
                    <span className="text-muted-foreground block text-xs">{description}</span>
                  </span>
                  {picking && source === "folder" ? (
                    <Loader2Icon className="text-muted-foreground size-4 shrink-0 animate-spin" />
                  ) : (
                    <ChevronRightIcon className="text-muted-foreground size-4 shrink-0" />
                  )}
                </button>
              ))}
              {error && <p className="text-destructive text-sm">{error}</p>}
            </div>
          </>
        ) : (
          <form onSubmit={submit} className="contents">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <option.icon className="text-muted-foreground size-4" />
                {option.title}
              </DialogTitle>
              <DialogDescription>{option.description}</DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-3">
              {source === "folder" && (
                <Field label="Folder" hint="Inside a git repo, the repo root becomes the project (even from a worktree).">
                  <FolderPicker
                    value={path}
                    picking={picking}
                    onPick={async () => {
                      const picked = await pickFolder("Choose a project folder", path);
                      if (picked) setPath(picked);
                    }}
                  />
                </Field>
              )}
              {source === "github" && (
                <Field label="Repository URL" hint="HTTPS, SSH, or owner/repo shorthand.">
                  <Input
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://github.com/owner/repo"
                    className="font-mono text-sm"
                    autoFocus
                  />
                </Field>
              )}
              {source === "new" && (
                <Field label="Folder name">
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="my-project"
                    className="font-mono text-sm"
                    autoFocus
                  />
                </Field>
              )}
              {source !== "folder" && (
                <Field label={source === "github" ? "Clone into" : "Create inside"}>
                  <FolderPicker
                    value={parent}
                    picking={picking}
                    onPick={async () => {
                      const picked = await pickFolder(
                        source === "github" ? "Choose where to clone the repo" : "Choose where to create the folder",
                        parent,
                      );
                      if (picked) setParent(picked);
                    }}
                  />
                </Field>
              )}
              {source === "new" && (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={initGit}
                    onChange={(e) => setInitGit(e.target.checked)}
                    className="accent-primary size-4"
                  />
                  Initialize a git repository
                </label>
              )}
              {error && <p className="text-destructive text-sm">{error}</p>}
            </div>

            <DialogFooter className="sm:justify-between">
              <Button type="button" variant="ghost" onClick={() => setSource(null)} disabled={pending || picking}>
                <ArrowLeftIcon />
                Back
              </Button>
              <Button type="submit" disabled={!canSubmit || picking}>
                {pending && <Loader2Icon className="animate-spin" />}
                {source === "github" ? (pending ? "Cloning…" : "Clone project") : source === "new" ? "Create project" : "Add project"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

const tildify = (p: string) => p.replace(/^\/Users\/[^/]+/, "~");

/** A folder chosen via the native picker: shows the path, click to choose another. */
function FolderPicker({ value, picking, onPick }: { value: string; picking: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={picking}
      className="hover:bg-muted focus-visible:ring-ring flex h-8 w-full items-center gap-2 rounded-lg border px-2.5 text-left transition-colors outline-none focus-visible:ring-2 disabled:opacity-60"
    >
      {picking ? (
        <Loader2Icon className="text-muted-foreground size-4 shrink-0 animate-spin" />
      ) : (
        <FolderIcon className="text-muted-foreground size-4 shrink-0" />
      )}
      <span className={cn("min-w-0 flex-1 truncate font-mono text-sm", !value && "text-muted-foreground")}>
        {picking ? "Waiting for Finder…" : value ? tildify(value) : "No folder chosen"}
      </span>
      <span className="text-muted-foreground shrink-0 text-xs">Choose…</span>
    </button>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium">{label}</span>
      {children}
      {hint && <span className="text-muted-foreground text-xs">{hint}</span>}
    </label>
  );
}
