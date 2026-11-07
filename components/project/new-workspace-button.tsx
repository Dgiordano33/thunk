"use client";

import { Loader2Icon, PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client/api";

/** One click: a new auto-named workspace (own worktree for repos), opened on a blank chat. */
export function NewWorkspaceButton({
  projectId,
  projectName,
  compact,
  className,
}: {
  projectId: string;
  projectName: string;
  compact?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const create = async () => {
    setPending(true);
    try {
      const { workspace } = await api.createWorkspace({ projectId });
      router.push(`/w/${workspace.id}/new`);
      router.refresh();
    } catch (err) {
      window.alert(`Couldn't create workspace: ${(err as Error).message}`);
    } finally {
      setPending(false);
    }
  };

  const icon = pending ? <Loader2Icon className="animate-spin" /> : <PlusIcon />;
  if (compact)
    return (
      <Button
        size="icon-xs"
        variant="ghost"
        aria-label={`New workspace in ${projectName}`}
        title="New workspace"
        className={className}
        onClick={create}
        disabled={pending}
      >
        {icon}
      </Button>
    );
  return (
    <Button size="sm" variant="outline" className={className} onClick={create} disabled={pending}>
      {icon}
      New workspace
    </Button>
  );
}
