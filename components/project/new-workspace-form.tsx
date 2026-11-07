"use client";

import { GitBranchIcon, Loader2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/client/api";
import type { Project } from "@/lib/projects/types";

export function NewWorkspaceForm({ project }: { project: Project }) {
  const router = useRouter();
  const isRepo = project.kind === "repo";
  const [name, setName] = useState("");
  const [worktree, setWorktree] = useState(isRepo);
  const [branch, setBranch] = useState("");
  const [baseRef, setBaseRef] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const { workspace } = await api.createWorkspace({
        projectId: project.id,
        name,
        worktree: isRepo && worktree,
        branch: branch.trim() || undefined,
        baseRef: baseRef.trim() || undefined,
      });
      router.push(`/w/${workspace.id}`);
    } catch (err) {
      setError((err as Error).message);
      setPending(false);
    }
  };

  const slugPreview = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Workspace name</span>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Fix onboarding flow" autoFocus />
      </label>

      {isRepo && (
        <>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={worktree} onChange={(e) => setWorktree(e.target.checked)} className="size-4" />
            <GitBranchIcon className="text-muted-foreground size-4" />
            Create a git worktree for this workspace
          </label>
          {worktree && (
            <div className="grid grid-cols-2 gap-3 pl-6">
              <label className="flex flex-col gap-1.5">
                <span className="text-muted-foreground text-xs">Branch</span>
                <Input
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  placeholder={`thunk/${slugPreview || "workspace"}`}
                  className="font-mono text-xs"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-muted-foreground text-xs">Branch from</span>
                <Input
                  value={baseRef}
                  onChange={(e) => setBaseRef(e.target.value)}
                  placeholder={project.defaultBranch ? `origin/${project.defaultBranch}` : "HEAD"}
                  className="font-mono text-xs"
                />
              </label>
              <p className="text-muted-foreground col-span-2 text-xs">
                Worktree at <span className="font-mono">.claude/worktrees/{slugPreview || "<slug>"}</span> inside the repo
                (excluded from git). Sessions still load CLAUDE.md and .claude/ from the main checkout.
              </p>
            </div>
          )}
        </>
      )}

      {error && <p className="text-destructive text-sm">{error}</p>}

      <Button type="submit" disabled={pending || !name.trim()} className="self-end">
        {pending && <Loader2Icon className="animate-spin" />}
        Create workspace
      </Button>
    </form>
  );
}
