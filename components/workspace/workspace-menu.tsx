"use client";

import { ArchiveIcon, ArchiveRestoreIcon, EllipsisIcon, Trash2Icon } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api } from "@/lib/client/api";
import type { Workspace } from "@/lib/projects/types";
import { cn } from "@/lib/utils";

/** Archive / delete for a sidebar workspace row. */
export function WorkspaceMenu({ workspace, label, className }: { workspace: Workspace; label: string; className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const viewing = pathname.startsWith(`/w/${workspace.id}`);
  const isMain = workspace.slug === "main";
  const archived = workspace.status === "archived";

  // Leaving the sidebar: step out to the project if we're looking at it.
  const done = () => {
    if (viewing) router.push(`/p/${workspace.projectId}`);
    router.refresh();
  };

  const toggleArchive = async () => {
    try {
      await api.updateWorkspace(workspace.id, { status: archived ? "active" : "archived" });
      done();
    } catch (err) {
      window.alert((err as Error).message);
    }
  };

  const remove = async () => {
    const what = workspace.worktreePath
      ? `Delete "${label}", its sessions, and the worktree at ${workspace.worktreePath}? Deletion requires committed changes merged into the default branch.`
      : `Delete "${label}" and its sessions?`;
    if (!window.confirm(what)) return;
    try {
      await api.deleteWorkspace(workspace.id, { worktree: true, memory: true });
      done();
    } catch (err) {
      window.alert((err as Error).message);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon-xs" variant="ghost" aria-label={`${label} options`} className={cn(className)}>
          <EllipsisIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-40">
        <DropdownMenuItem onSelect={toggleArchive}>
          {archived ? <ArchiveRestoreIcon /> : <ArchiveIcon />}
          {archived ? "Unarchive" : "Archive"}
        </DropdownMenuItem>
        {!isMain && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={remove}>
              <Trash2Icon />
              Delete
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
