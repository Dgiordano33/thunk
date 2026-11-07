"use client";

import { FolderIcon, Loader2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/client/api";

export function AddProjectForm() {
  const router = useRouter();
  const [path, setPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const { project } = await api.addProject(path);
      router.push(`/p/${project.id}`);
    } catch (err) {
      setError((err as Error).message);
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <FolderIcon className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="~/code/my-repo or any folder"
            className="pl-8 font-mono text-sm"
            autoFocus
          />
        </div>
        <Button type="submit" disabled={pending || !path.trim()}>
          {pending && <Loader2Icon className="animate-spin" />}
          Add project
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">
        Inside a git repo, the repo root becomes the project (even from a worktree). Otherwise the folder itself does.
      </p>
      {error && <p className="text-destructive text-sm">{error}</p>}
    </form>
  );
}
