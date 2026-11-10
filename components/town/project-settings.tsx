"use client";

import { Loader2Icon, Trash2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ProjectConfig } from "./project-config";
import { api } from "@/lib/client/api";

/** Rename or delete a project. Forgetting leaves files, worktrees and memory on disk. */
export function ProjectSettings({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [value, setValue] = useState(name);
  const [pending, setPending] = useState<"rename" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmName, setConfirmName] = useState("");

  const rename = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!value.trim() || value.trim() === name) return;
    setPending("rename");
    setError(null);
    try {
      await api.renameProject(id, value.trim());
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(null);
    }
  };

  const remove = async () => {
    if (confirmName.trim() !== name) return;
    setPending("remove");
    setError(null);
    try {
      await api.deleteProject(id);
      router.push("/");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setPending(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <ProjectConfig key={id} id={id} />
      <form onSubmit={rename} className="flex items-center gap-2">
        <label htmlFor="project-name" className="sr-only">Project name</label>
        <Input id="project-name" value={value} maxLength={80} onChange={(e) => setValue(e.target.value)} className="h-8 text-sm" />
        <Button type="submit" size="sm" variant="outline" disabled={!value.trim() || value.trim() === name || pending !== null}>
          {pending === "rename" && <Loader2Icon className="animate-spin" />}
          Rename
        </Button>
      </form>
      <section className="border-destructive/40 mt-2 flex flex-col gap-2 border p-3">
        <h4 className="pixel text-destructive text-xs tracking-widest uppercase">Danger zone</h4>
        <p className="text-muted-foreground text-xs">
          Deleting stops this project&apos;s sessions and removes its workspaces, sessions, notes and routines from Thunk. Files, worktrees and memory on disk are left alone.
        </p>
        <Dialog onOpenChange={(open) => !open && setConfirmName("")}>
          <DialogTrigger asChild>
            <Button type="button" size="sm" variant="destructive" className="self-start" disabled={pending !== null}>
              <Trash2Icon />
              Delete project
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete {name}?</DialogTitle>
              <DialogDescription>
                This can&apos;t be undone. Running sessions stop and the project&apos;s records are deleted. Type the project name to confirm.
              </DialogDescription>
            </DialogHeader>
            <label htmlFor="confirm-project-name" className="sr-only">Project name</label>
            <Input id="confirm-project-name" value={confirmName} onChange={(e) => setConfirmName(e.target.value)} placeholder="Type the project name" autoComplete="off" className="h-8 text-sm" />
            {error && <p role="alert" className="text-destructive text-xs">{error}</p>}
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" size="sm" variant="outline">Cancel</Button>
              </DialogClose>
              <Button type="button" size="sm" variant="destructive" onClick={remove} disabled={confirmName.trim() !== name || pending !== null}>
                {pending === "remove" ? <Loader2Icon className="animate-spin" /> : <Trash2Icon />}
                Delete project
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </section>
      {error && <p role="alert" className="text-destructive text-xs">{error}</p>}
    </div>
  );
}
