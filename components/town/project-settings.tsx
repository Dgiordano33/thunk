"use client";

import { Loader2Icon, Trash2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/client/api";

/** Rename or forget a project. Forgetting leaves files, worktrees and memory on disk. */
export function ProjectSettings({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [value, setValue] = useState(name);
  const [pending, setPending] = useState<"rename" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    if (!window.confirm(`Remove "${name}" from Thunk? Its sessions stop and its records are deleted. Files, worktrees and memory on disk are left alone.`)) return;
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
      <form onSubmit={rename} className="flex items-center gap-2">
        <label htmlFor="project-name" className="sr-only">Project name</label>
        <Input id="project-name" value={value} maxLength={80} onChange={(e) => setValue(e.target.value)} className="h-8 text-sm" />
        <Button type="submit" size="sm" variant="outline" disabled={!value.trim() || value.trim() === name || pending !== null}>
          {pending === "rename" && <Loader2Icon className="animate-spin" />}
          Rename
        </Button>
      </form>
      <Button type="button" size="sm" variant="ghost" className="text-destructive self-start" onClick={remove} disabled={pending !== null}>
        {pending === "remove" ? <Loader2Icon className="animate-spin" /> : <Trash2Icon />}
        Remove project
      </Button>
      {error && <p role="alert" className="text-destructive text-xs">{error}</p>}
    </div>
  );
}
