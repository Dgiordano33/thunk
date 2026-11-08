"use client";

import { Loader2Icon, PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { api } from "@/lib/client/api";

/**
 * A new auto-named workspace (own worktree for repos), opened on a blank chat. One click for
 * single-repo projects; with extra repos, a picker of which ones to include first (all by default).
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
  /** The project's extra repos; the primary repo is always included. */
  repos?: { id: string; name: string }[];
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

  const icon = pending ? <Loader2Icon className="animate-spin" /> : <PlusIcon />;
  const trigger = compact ? (
    <Button
      size="icon-xs"
      variant="ghost"
      aria-label={`New workspace in ${projectName}`}
      title="New workspace"
      className={className}
      onClick={repos.length ? undefined : () => void create()}
      disabled={pending}
    >
      {icon}
    </Button>
  ) : (
    <Button size="sm" variant="outline" className={className} onClick={repos.length ? undefined : () => void create()} disabled={pending}>
      {icon}
      New workspace
    </Button>
  );
  if (!repos.length) return trigger;

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
            <label className="text-muted-foreground flex items-center gap-2 text-sm">
              <input type="checkbox" checked disabled className="accent-primary size-4" />
              {projectName}
            </label>
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
          <Button type="submit" size="sm" disabled={pending}>
            {pending && <Loader2Icon className="animate-spin" />}
            Create workspace
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
