"use client";

import { Loader2Icon, PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { api } from "@/lib/client/api";

/**
 * A new auto-named workspace (a worktree in each git repo), opened on a blank chat. One click for a
 * single-repo project; with several repos, a picker of which ones to include first (all by default).
 */
export function NewWorkspaceButton({
  projectId,
  projectName,
  repos = [],
  compact,
  className,
}: {
  projectId: string;
  projectName: string;
  repos?: { id: string; name: string; kind: "repo" | "folder" }[];
  compact?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(repos.map((r) => r.id)));

  const create = async (repoIds?: string[]) => {
    setPending(true);
    try {
      const { workspace } = await api.createWorkspace({ projectId, ...(repoIds ? { repoIds } : {}) });
      setOpen(false);
      router.push(`/w/${workspace.id}/new`);
      router.refresh();
    } catch (err) {
      window.alert(`Couldn't create workspace: ${(err as Error).message}`);
    } finally {
      setPending(false);
    }
  };

  // A workspace is a worktree, so it needs at least one git repo among those chosen.
  const hasGit = repos.some((r) => r.kind === "repo");
  const canPick = repos.some((r) => r.kind === "repo" && chosen.has(r.id));
  const needsPicker = repos.length > 1;
  const noRepoHint = "Add a git repo to create workspaces";

  const icon = pending ? <Loader2Icon className="animate-spin" /> : <PlusIcon />;
  const trigger = compact ? (
    <Button
      size="icon-xs"
      variant="ghost"
      aria-label={`New workspace in ${projectName}`}
      title={hasGit ? "New workspace" : noRepoHint}
      className={className}
      onClick={needsPicker ? undefined : () => void create()}
      disabled={pending || !hasGit}
    >
      {icon}
    </Button>
  ) : (
    <Button size="sm" variant="outline" className={className} title={hasGit ? undefined : noRepoHint} onClick={needsPicker ? undefined : () => void create()} disabled={pending || !hasGit}>
      {icon}
      New workspace
    </Button>
  );
  if (!hasGit) {
    // A disabled button shows no tooltip, so the hint sits on its wrapper; the full-size button also spells it out.
    return (
      <span title={noRepoHint} className="inline-flex items-center gap-2">
        {trigger}
        {!compact && <span className="text-muted-foreground text-xs">{noRepoHint}.</span>}
      </span>
    );
  }
  if (!needsPicker) return trigger;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        // Every repo is ticked again each time the picker opens.
        if (next) setChosen(new Set(repos.map((r) => r.id)));
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void create(repos.filter((r) => chosen.has(r.id)).map((r) => r.id));
          }}
          className="flex flex-col gap-3"
        >
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-xs font-medium">Repos in this workspace</legend>
            {repos.map((r) => (
              <label key={r.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="accent-primary size-4"
                  checked={chosen.has(r.id)}
                  onChange={(e) =>
                    setChosen((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(r.id);
                      else next.delete(r.id);
                      return next;
                    })
                  }
                />
                {r.name}
              </label>
            ))}
          </fieldset>
          <Button type="submit" size="sm" disabled={pending || !canPick}>
            {pending && <Loader2Icon className="animate-spin" />}
            Create workspace
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
